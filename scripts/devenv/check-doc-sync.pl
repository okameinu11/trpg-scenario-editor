#!/usr/bin/env perl

# pre-commitフックの本体: devenv.config.json の syncRules / referenceRules を評価する。
#
# ## これが解いている問題
#
# AIエージェントが実装を担う運用では、コードだけが進みドキュメントが取り残される。
# 「更新してください」という取り決めをCLAUDE.mdに書いても、書いただけでは守られない。
# そこで「Aを変更したならBも同じコミットに含まれていること」を機械的に検査する。
#
# チェック内容ごとに個別スクリプトを書くと、中身は「トリガのglob」「要求するファイル」
# 「ブロックか警告か」しか違わないのにファイルだけが増える。ここでは1本のエンジンに集約し、
# 差分は設定ファイルで表現する。
#
# ## 実行に必要なもの
#
# git と Perl だけ。Node・npm・python・jq のいずれも要らない。
# Git for Windows は Perl を同梱しており、JSON::PP は Perl コアモジュールである。
#
#   perl scripts/devenv/check-doc-sync.pl
#   perl scripts/devenv/check-doc-sync.pl --summary   # 現在のルール一覧をMarkdownで出力
#
# ## ルールの形
#
# {
#   "id": "db-doc-sync",
#   "level": "block",                       // block=コミット中断 / warn=警告のみ
#   "trigger": {
#     "changed": ["db/migrations/**/*.sql"],
#     "exclude": ["**/__tests__/**"],       // 任意
#     "diffFilter": "ACMR",                 // 任意。既定はACMR。追加/削除の検知は"AD"
#     "containsAdded": ["CREATE POLICY"]    // 任意。追加行がこれに当たるファイルだけを対象にする
#   },
#   "require": { "all": ["docs/06_DB設計書.html"] },   // all または any。省略可
#   "message": "DBスキーマを変更したら設計書も同じコミットで更新すること",
#   "identifierWarning": {                  // 任意。非ブロッキングの記述漏れ検査
#     "extract": ["CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?\"?(\\w+)\"?"],
#     "searchIn": ["docs/06_DB設計書.html"],
#     "scope": { "diffFilter": "ACMR" },    // 任意。走査範囲を trigger と別に指定する
#     "message": "以下の新規テーブル名が設計書に見当たりません"
#   }
# }
#
# ## require を省略したルール
#
# 「同じコミットに含めるべきファイル」が存在しない合図もある。
# （例:「src/components/ を触ったらフロントエンドの品質Skillの実行を検討する」）
# require を省略すると、trigger に当たった時点で message を出すだけのルールになる。
#
#   - containsAdded が無い場合は level に関わらず warn 扱い。
#     「そのディレクトリを触った」だけでコミットを止めてよい理由は無いため。
#   - containsAdded がある場合は level を尊重する（block も書ける）。
#     こちらは「差分に書いてはいけないものが入った」という具体的な検知であり、
#     ブロックする根拠になる。ただしブロックにするのは誤検知がほぼ無いものだけにすること。
#
# なお require を省略したルールでは identifierWarning は評価しない
# （照合先のドキュメントが決まらないため）。
#
# ## 設計上の約束
#
# - level: "block" は「機械的に判定でき、誤検知がほぼ無い」ものに限る。
#   判断を伴うもの（本当に更新が必要か人が決めるもの）は必ず warn にする。
#   ブロックが誤検知だらけになると --no-verify が常用され、全チェックが死ぬ。
# - 警告は「何をどう直すか」まで書く。「確認してください」だけでは動けない。

use strict;
use warnings;
use utf8;
use File::Spec ();
use FindBin ();
use lib $FindBin::Bin;
use Devenv qw(load_config staged_files added_lines glob_match glob_match_any filter_by_globs
              tracked_files_matching setup_output_encoding);

setup_output_encoding();

my $config     = load_config();
my $rules      = ref($config->{syncRules}) eq 'ARRAY' ? $config->{syncRules} : [];
my $ref_rules  = ref($config->{referenceRules}) eq 'ARRAY' ? $config->{referenceRules} : [];

# ---------------------------------------------------------------- 共通

# 複数行メッセージを配列でも文字列でも受け取れるようにする。
sub message_lines {
    my ($message) = @_;
    return @$message if ref($message) eq 'ARRAY';
    return ($message) if defined $message && !ref($message) && length $message;
    return ();
}

sub rule_id {
    my ($rule) = @_;
    return (ref($rule) eq 'HASH' && defined $rule->{id}) ? $rule->{id} : '(id未設定)';
}

sub abs_path_of {
    my ($relative) = @_;
    return File::Spec->catfile($config->{rootDir}, split(m{/}, $relative));
}

sub read_text {
    my ($relative) = @_;
    my $absolute = abs_path_of($relative);
    return undef unless -f $absolute;
    open(my $fh, '<:encoding(UTF-8)', $absolute) or return undef;
    local $/;
    my $text = <$fh>;
    close($fh);
    return $text;
}

# ---------------------------------------------------------------- ルール一覧の出力

# CLAUDE.md に載せるゲート一覧を設定から生成する。
#
# 一覧を人手で書き写すと必ず実態からずれる（実際に「10件」と書かれた横で12件走っていた）。
# エージェントは書いてあることを前提に動くため、ずれはそのまま実害になる。
# 貼るだけで済むようにして、ずれる余地そのものを無くす。

sub md_escape {
    my ($text) = @_;
    return '' unless defined $text;
    $text =~ s/\|/\\|/g;
    $text =~ s/\s*\R\s*/ /g;
    return $text;
}

sub md_code_list {
    my ($items, $limit) = @_;
    return '—' unless ref($items) eq 'ARRAY' && @$items;
    $limit = 2 unless defined $limit;

    my @shown = @$items > $limit ? @$items[ 0 .. $limit - 1 ] : @$items;
    my $text = join(', ', map { '`' . md_escape($_) . '`' } @shown);
    $text .= ' ほか' . (scalar(@$items) - $limit) . '件' if @$items > $limit;
    return $text;
}

sub md_first_line {
    my ($message) = @_;
    my @lines = message_lines($message);
    return @lines ? md_escape($lines[0]) : '—';
}

sub summarize_trigger {
    my ($trigger) = @_;
    my $text = md_code_list($trigger->{changed});

    my $filter = $trigger->{diffFilter};
    if (defined $filter && $filter ne 'ACMR') {
        $text .= ($filter eq 'AD') ? '（追加・削除時のみ）' : "（diffFilter: $filter）";
    }
    if (ref($trigger->{containsAdded}) eq 'ARRAY' && @{ $trigger->{containsAdded} }) {
        $text .= '<br>追加行が ' . md_code_list($trigger->{containsAdded}, 1) . ' に当たるときだけ';
    }
    return $text;
}

sub print_summary {
    print "<!-- この表は `perl scripts/devenv/check-doc-sync.pl --summary` で再生成できる。手で書き足さないこと -->\n\n";
    print "| ID | 種別 | 変更を検知する対象 | 同じコミットに要求するもの | 目的 |\n";
    print "|---|---|---|---|---|\n";

    for my $rule (@$rules) {
        next unless ref($rule) eq 'HASH';
        my $trigger     = ref($rule->{trigger}) eq 'HASH' ? $rule->{trigger} : {};
        my $requirement = ref($rule->{require}) eq 'HASH' ? $rule->{require} : {};
        my $all         = ref($requirement->{all}) eq 'ARRAY' ? $requirement->{all} : [];
        my $any         = ref($requirement->{any}) eq 'ARRAY' ? $requirement->{any} : [];
        my $contains    = ref($trigger->{containsAdded}) eq 'ARRAY' && @{ $trigger->{containsAdded} };

        my $kind = (defined $rule->{level} && $rule->{level} eq 'block' && (@$all || @$any || $contains))
            ? 'ブロック' : '警告';
        $kind .= '（無効）' if defined $rule->{enabled} && !$rule->{enabled};

        my @requires;
        push @requires, 'すべて: ' . md_code_list($all) if @$all;
        push @requires, 'いずれか: ' . md_code_list($any) if @$any;
        my $require_text = @requires ? join('<br>', @requires) : '（通知のみ）';

        printf(
            "| `%s` | %s | %s | %s | %s |\n",
            md_escape(rule_id($rule)), $kind, summarize_trigger($trigger),
            $require_text, md_first_line($rule->{message})
        );
    }

    for my $rule (@$ref_rules) {
        next unless ref($rule) eq 'HASH';
        my $trigger = ref($rule->{trigger}) eq 'HASH' ? $rule->{trigger} : {};
        printf(
            "| `%s` | 警告 | %s | 記述された参照先が実在すること | %s |\n",
            md_escape(rule_id($rule)), summarize_trigger($trigger), md_first_line($rule->{message})
        );
    }

    my $guarded = ref($config->{guardedCommands}) eq 'ARRAY' ? $config->{guardedCommands} : [];
    print "\n<!-- 遮断されるコマンド。同じく --summary で再生成できる -->\n\n";
    if (!@$guarded) {
        print "遮断コマンドの設定はありません（`.claude/hooks/guard-commands.*` の BASELINE のみが働きます）。\n";
        return;
    }
    print "| ID | 遮断するコマンド | 理由 |\n";
    print "|---|---|---|\n";
    for my $rule (@$guarded) {
        next unless ref($rule) eq 'HASH';
        my $pattern = defined $rule->{pattern} ? '`' . md_escape($rule->{pattern}) . '`' : '—';
        $pattern .= '<br>ただし `' . md_escape($rule->{unless}) . '` を含むときは除く'
            if defined $rule->{unless};
        printf("| `%s` | %s | %s |\n", md_escape(rule_id($rule)), $pattern, md_escape($rule->{reason}));
    }
}

# ---------------------------------------------------------------- syncRules

# searchIn はglobではなく実ファイルパスの配列として扱う。
# HTMLドキュメントを対象にするため、タグを落として本文だけで照合する。
sub read_search_targets {
    my ($patterns) = @_;
    my $text = '';
    for my $file (@$patterns) {
        my $raw = read_text($file);
        next unless defined $raw;
        $raw =~ s/<[^>]*>/ /g;
        $text .= "$raw\n";
    }
    return $text;
}

sub collect_identifiers {
    my ($files, $patterns) = @_;
    my %found;
    for my $file (@$files) {
        for my $line (added_lines($file)) {
            for my $pattern (@$patterns) {
                my $regex = eval { qr/$pattern/i };
                next unless $regex;
                while ($line =~ /$regex/g) {
                    $found{$1} = 1 if defined $1;
                }
            }
        }
    }
    return sort keys %found;
}

# 追加行が containsAdded のいずれかに当たるか。
#
# ファイル名だけでは変更の「種類」が判別できないことは多い
# （同じマイグレーションでも、RLSポリシーを作る差分とインデックスを足す差分では要求が違う）。
sub has_matching_added_line {
    my ($file, $patterns) = @_;
    for my $line (added_lines($file)) {
        for my $pattern (@$patterns) {
            my $regex = eval { qr/$pattern/i };
            next unless $regex;
            return 1 if $line =~ $regex;
        }
    }
    return 0;
}

# 要求ファイルは揃っているが中身が今回の変更に追いついていない、を拾う非ブロッキング検査。
#
# 走査範囲(scope)は trigger と別に指定できる。
# 「新規追加だけをブロックしたいが、記述漏れの走査は変更全体に掛けたい」ように、
# 止める対象と見る対象が一致しないことがあるため。
# ルールを2つに割って表現すると、ドキュメントが未ステージのときに同じ不足で警告が二重に出る。
sub warn_missing_identifiers {
    my ($id, $warning, $trigger, $required_all, $default_files) = @_;

    my @scan;
    if (ref($warning->{scope}) eq 'HASH') {
        my $scope  = $warning->{scope};
        my @scoped = staged_files(
            defined $scope->{diffFilter} ? $scope->{diffFilter} : $trigger->{diffFilter}
        );
        @scan = filter_by_globs(
            \@scoped,
            ref($scope->{changed}) eq 'ARRAY' ? $scope->{changed} : $trigger->{changed},
            ref($scope->{exclude}) eq 'ARRAY' ? $scope->{exclude} : $trigger->{exclude},
        );
    }
    elsif (ref($default_files) eq 'ARRAY') {
        @scan = @$default_files;
    }
    return unless @scan;

    my @identifiers = collect_identifiers(\@scan, $warning->{extract});
    return unless @identifiers;

    my $search_in = ref($warning->{searchIn}) eq 'ARRAY' ? $warning->{searchIn} : $required_all;
    return unless @$search_in;

    my $haystack = read_search_targets($search_in);
    my @missing  = grep { index($haystack, $_) < 0 } @identifiers;
    return unless @missing;

    my @text = message_lines($warning->{message});
    @text = ('以下の新規識別子がドキュメントに見当たりません。') unless @text;

    print "\n[$id] 警告: " . join(' ', @text) . "\n";
    print '  ' . join(', ', @missing) . "\n";
    print "  記述漏れが無いか確認してください（このチェックはコミットをブロックしません）。\n\n";
}

sub print_detected {
    my ($out, $files) = @_;
    print {$out} "  変更を検知したファイル:\n";
    my @shown = @$files > 10 ? @$files[ 0 .. 9 ] : @$files;
    print {$out} "    - $_\n" for @shown;
    print {$out} "    …ほか " . (scalar(@$files) - 10) . " 件\n" if @$files > 10;
}

sub evaluate_rule {
    my ($rule) = @_;

    return 0 if defined $rule->{enabled} && !$rule->{enabled};

    my $id      = rule_id($rule);
    my $trigger = ref($rule->{trigger}) eq 'HASH' ? $rule->{trigger} : {};

    my $warning = ref($rule->{identifierWarning}) eq 'HASH'
               && ref($rule->{identifierWarning}{extract}) eq 'ARRAY'
        ? $rule->{identifierWarning} : undef;

    my $requirement  = ref($rule->{require}) eq 'HASH' ? $rule->{require} : {};
    my $required_all = ref($requirement->{all}) eq 'ARRAY' ? $requirement->{all} : [];
    my $required_any = ref($requirement->{any}) eq 'ARRAY' ? $requirement->{any} : [];

    my @all_triggered = staged_files($trigger->{diffFilter});
    my @triggered = filter_by_globs(\@all_triggered, $trigger->{changed}, $trigger->{exclude});

    # 差分の中身で絞る。ここで残らなければ、このルールは無関係な変更だったということ。
    my $contains = ref($trigger->{containsAdded}) eq 'ARRAY' && @{ $trigger->{containsAdded} }
        ? $trigger->{containsAdded} : undef;
    if ($contains && @triggered) {
        @triggered = grep { has_matching_added_line($_, $contains) } @triggered;
    }

    # トリガが外れても、走査範囲を別に持つルールは記述漏れ検査だけ続ける。
    # 「新規追加だけを止めるが、記述漏れは変更全体で見たい」がこれで書ける。
    if (!@triggered) {
        return 0 unless $warning && ref($warning->{scope}) eq 'HASH';
        warn_missing_identifiers($id, $warning, $trigger, $required_all, undef);
        return 0;
    }

    # require の無いルール = 通知のみ、または「書いてはいけないものが入った」検知。
    if (!@$required_all && !@$required_any) {
        my $is_blocking = ($contains && defined $rule->{level} && $rule->{level} eq 'block') ? 1 : 0;
        my $out = $is_blocking ? \*STDERR : \*STDOUT;

        print {$out} "\n[$id] "
            . ($is_blocking ? "コミットを中断します。\n" : "確認してください（コミットは止めません）。\n");
        print {$out} "  $_\n" for message_lines($rule->{message});
        print_detected($out, \@triggered);
        print {$out} "\n";

        return $is_blocking;
    }

    # require側は常にACMRで判定する（削除されたドキュメントは「更新した」とみなさない）
    my @staged = staged_files('ACMR');

    my @missing_all = grep {
        my $pattern = $_;
        !grep { glob_match($_, $pattern) } @staged;
    } @$required_all;

    my $any_satisfied = !@$required_any || grep { glob_match_any($_, $required_any) } @staged;

    my $is_blocking = defined $rule->{level} && $rule->{level} eq 'block';

    if (@missing_all || !$any_satisfied) {
        my $out = $is_blocking ? \*STDERR : \*STDOUT;
        my $headline = $is_blocking
            ? 'コミットを中断します。'
            : '確認してください（コミットは止めません）。';

        print {$out} "\n[$id] $headline\n";
        print {$out} "  $_\n" for message_lines($rule->{message});

        if (@missing_all) {
            print {$out} "  同じコミットに含める必要があるファイル:\n";
            print {$out} "    - $_\n" for @missing_all;
        }
        if (!$any_satisfied && @$required_any) {
            print {$out} "  次のいずれかを同じコミットに含めてください:\n";
            print {$out} "    - $_\n" for @$required_any;
        }

        print_detected($out, \@triggered);
        print {$out} "\n";

        return $is_blocking ? 1 : 0;
    }

    # 要求ファイルは揃っている。ここから先は「揃っているが中身が空回りしていないか」の
    # 非ブロッキング検査。誤検知しうるので絶対にブロックしない。
    warn_missing_identifiers($id, $warning, $trigger, $required_all, \@triggered) if $warning;

    return 0;
}

# ---------------------------------------------------------------- referenceRules

# ドキュメントが指しているファイルが実在するかを見る。
#
# ## なぜ必要か
#
# syncRules は「同じコミットに入っているか」しか見ない。スクリプトやスキルを
# 改名・削除すると、それを指しているドキュメント側の記述は黙って壊れる。
# 壊れた側は今回の差分に含まれていないので、差分だけを見るチェックでは永久に検知できない。
#
# AIエージェントが実装を担う運用では、存在しないファイルを指す記述はそのまま実害になる
# （探しに行って見つからず、別の手段を取ろうとする）。
#
# 走るのは「参照先になりうる場所のファイルが追加・削除・改名されたとき」だけ。
# 毎コミット走らせると、既にある古い参照を延々と報告し続けて読まれなくなる。

sub extract_references {
    my ($text, $prefixes) = @_;
    my %found;

    for my $prefix (@$prefixes) {
        my $quoted = quotemeta($prefix);
        while ($text =~ /(?<![\w.\/-])($quoted[\w.\/-]*)/g) {
            my $token = $1;

            # `scripts/**` や `.claude/hooks/audit-log.*` はglob表記であって参照ではない
            my $next = substr($text, pos($text), 1);
            next if defined $next && ($next eq '*' || $next eq '?');

            $token =~ s{[./-]+\z}{};    # 文末の句読点・装飾を落とす
            next unless length $token;
            $found{$token} = 1;
        }
    }

    return sort keys %found;
}

sub evaluate_reference_rule {
    my ($rule) = @_;

    return 0 if defined $rule->{enabled} && !$rule->{enabled};

    my $id      = rule_id($rule);
    my $trigger = ref($rule->{trigger}) eq 'HASH' ? $rule->{trigger} : {};

    my @all_triggered = staged_files(defined $trigger->{diffFilter} ? $trigger->{diffFilter} : 'ADR');
    my @triggered = filter_by_globs(\@all_triggered, $trigger->{changed}, $trigger->{exclude});
    return 0 unless @triggered;

    my $prefixes = ref($rule->{prefixes}) eq 'ARRAY' ? $rule->{prefixes} : [];
    my $scan_in  = ref($rule->{scanIn}) eq 'ARRAY' ? $rule->{scanIn} : [];
    return 0 unless @$prefixes && @$scan_in;

    my $ignore = ref($rule->{ignore}) eq 'ARRAY' ? $rule->{ignore} : [];
    my @documents = tracked_files_matching($scan_in, $rule->{exclude});

    my (%where, @order);
    for my $document (@documents) {
        my $text = read_text($document);
        next unless defined $text;

        for my $token (extract_references($text, $prefixes)) {
            # ディレクトリへの参照は末尾の `/` を落としてあるので、
            # `.claude/logs/**` のようなglobと突き合わせるために復元した形でも試す。
            next if @$ignore
                 && (glob_match_any($token, $ignore) || glob_match_any("$token/", $ignore));
            next if -e abs_path_of($token);

            push @order, $token unless exists $where{$token};
            push @{ $where{$token} }, $document
                unless grep { $_ eq $document } @{ $where{$token} || [] };
        }
    }

    return 0 unless @order;

    print "\n[$id] 確認してください（コミットは止めません）。\n";
    my @lines = message_lines($rule->{message});
    @lines = (
        'ドキュメントが存在しないファイルを指しています。改名・削除の際の追従漏れです。',
        '参照先を新しいパスに直すか、記述そのものを削除してください。',
    ) unless @lines;
    print "  $_\n" for @lines;

    for my $token (@order) {
        print "    - $token\n";
        print "        ← $_\n" for @{ $where{$token} };
    }
    print "\n";

    return 0;
}

# ---------------------------------------------------------------- 実行

for my $arg (@ARGV) {
    if ($arg eq '--summary') {
        print_summary();
        exit 0;
    }
    if ($arg eq '--help' || $arg eq '-h') {
        print "使い方: perl scripts/devenv/check-doc-sync.pl [--summary]\n";
        print "  引数なし   pre-commit と同じ検査を行う\n";
        print "  --summary  現在のルール一覧をMarkdownの表として出力する\n";
        exit 0;
    }
    print STDERR "不明な引数: $arg\n";
    exit 1;
}

exit 0 unless @$rules || @$ref_rules;

my $blocked = 0;

# 1つのルールの不備で全チェックが落ちると、他のブロッキングチェックまで効かなくなる。
# ルール単位で握りつぶし、設定の問題として知らせる。
sub run_rule {
    my ($rule, $evaluate) = @_;
    return unless ref($rule) eq 'HASH';

    my $result = eval { $evaluate->($rule) };
    if ($@) {
        my $reason = $@;
        $reason =~ s/\s+\z//;
        print "[devenv] ルール \"" . rule_id($rule) . "\" の評価に失敗しました: $reason\n";
        return;
    }
    $blocked = 1 if $result;
}

run_rule($_, \&evaluate_rule)           for @$rules;
run_rule($_, \&evaluate_reference_rule) for @$ref_rules;

exit($blocked ? 1 : 0);
