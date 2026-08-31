#!/usr/bin/env perl

# PreToolUse hook (Bash): エージェントが実行したコマンドを記録する。
#
# audit-log.js と同じことをする Perl 版。Node が無い環境ではこちらを使う
# （どちらを使うかは .claude/settings.json の hooks 設定で決まる）。
#
# ## なぜ必要か
#
# 権限プロンプトを自動承認する運用（オートモード）にすると、「何が実行されたか」を
# 目で追う機会が無くなる。コードの変更は git で追えるが、Bashコマンドそのものは
# git に残らない。とくに痕跡が残りにくいのは次のもの。
#
#   - DBへの書き込み（管理者キーで権限制御を迂回する検証スクリプト）
#   - ファイルの一括置換を行う `node -e` / 使い捨てスクリプト
#   - git commit / git rm などの履歴操作
#
# このフックは何もブロックしない（常に exit 0）。記録だけを行う。
# ブロックが必要な操作は guard-commands.pl が別に担当する。
#
# 記録先は既定で `.claude/logs/2026-08/agent-actions-2026-08-31.log` のように
# 日付ごとに分かれる（auditLog.rotate で変更可能）。
# 記録を読む手順は .claude/skills/audit-log-check を参照。

use strict;
use warnings;
use utf8;
use File::Basename ();
use File::Path ();
use File::Spec ();
use FindBin ();
use JSON::PP ();
use lib File::Spec->catdir($FindBin::Bin, File::Spec->updir, File::Spec->updir, 'scripts', 'devenv');
use Devenv qw(load_config audit_log_path);

my $config      = load_config();
my $audit       = ref($config->{auditLog}) eq 'HASH' ? $config->{auditLog} : {};
exit 0 if exists $audit->{enabled} && !$audit->{enabled};

my $log_file = audit_log_path($config);

# テーブル参照。スキーマ修飾（public.users）と引用符（"users"）を許す。
# これが無いと、最も記録したい本物の書き込み（psql で public.xxx を更新する等）を
# 取りこぼす。検知漏れは誤検知より危険で、「印が無い＝安全」と誤読させる。
my $TABLE_REF     = q{(?:"[^"]+"|\w+)};
my $QUALIFIED_REF = $TABLE_REF . q{\s*\.\s*} . $TABLE_REF;

# 生SQLによるデータ・スキーマ変更。
#
# TRUNCATE を裸で拾わないのは、Tailwind の `truncate` クラスに誤爆するため。
# TSXを1枚書くたびにSQLの印が付くと、印が目印として機能しなくなる。
# そこで `TRUNCATE TABLE` かスキーマ修飾されたテーブル名が続く形だけを対象にする。
my $SQL_WRITE =
      q{\b(?:INSERT\s+INTO\b|UPDATE\s+}
    . $TABLE_REF
    . q{(?:\s*\.\s*}
    . $TABLE_REF
    . q{)?\s+SET\b|DELETE\s+FROM\b|TRUNCATE\s+(?:TABLE\b|}
    . $QUALIFIED_REF
    . q{)|DROP\s+(?:TABLE|SCHEMA|DATABASE)\b|ALTER\s+TABLE\b)};

# 「あとから必ず見返したい」操作。行頭に印を付けて grep で拾えるようにする。
# 印は絞ること。全部に印が付くと目印として機能しなくなる。
my @DEFAULT_LABELS = (
    { pattern => '\bgit\s+(commit|rm|reset|checkout|restore|stash|revert)\b', label => 'GIT' },
    { pattern => '\bgit\s+push\b',                                           label => 'PUSH' },
    { pattern => '\bnode\s+-e\b',                                            label => 'INLINE-SCRIPT' },
    { pattern => '\b(rm|mv|cp)\s+-[a-zA-Z]*[rf]',                            label => 'FS' },
    { pattern => 'writeFileSync|unlinkSync|rmSync',                          label => 'FS-WRITE' },
    { pattern => '\b(taskkill|kill\s+-9|pkill)\b',                           label => 'PROC' },
    {
        pattern => '\b(curl|wget|Invoke-WebRequest)\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--data)',
        label   => 'NET-WRITE',
    },
    # ORM経由の書き込みはプロジェクト側で extraLabels に足す。
    { pattern => $SQL_WRITE, label => 'SQL-WRITE' },
);

# プロジェクト固有の印は devenv.config.json の auditLog.extraLabels で足す。
# requires / unless があるのは、「鍵を使った」だけで「書き込んだ」印を付けると
# 誤検知だらけになるため。読み取り専用のスクリプトにも印が付くと、
# 「見返すべき操作」の目印として機能しなくなる。
my @extra = ref($audit->{extraLabels}) eq 'ARRAY' ? @{ $audit->{extraLabels} } : ();

# ファイルへリダイレクトされるヒアドキュメントの本文を、分類対象から取り除く。
#
# エージェントがソースコードを書く手段としてヒアドキュメントは日常的に使われる。
# 書き込まれる中身に `.update(` や `DELETE FROM` が含まれるだけでDB操作の印が付くと、
# 印の付いた記録の大半が「ソースを書いただけ」になり、本物が埋もれる。
#
# リダイレクトを伴わないもの（`psql <<'SQL'` のように標準入力へ渡して実行するもの）は
# 取り除かない。そちらは実際に実行される中身であり、記録の対象そのものである。
sub is_file_redirect {
    my ($command, $marker_index) = @_;

    my $line_start = rindex($command, "\n", $marker_index) + 1;
    my $newline    = index($command, "\n", $marker_index);
    my $line_end   = $newline == -1 ? length($command) : $newline;
    my $header     = substr($command, $line_start, $line_end - $line_start);

    # `2>&1` のようなfd複製は除く（> の直前が数字、直後が & のもの）
    return $header =~ /(?:^|[^0-9<>&])>>?\s*[^&|>\s]/ ? 1 : 0;
}

sub strip_redirected_heredocs {
    my ($command) = @_;

    my $result = '';
    my $cursor = 0;

    while ($command =~ /<<-?\s*(['"]?)(\w+)\1/g) {
        my $marker_index = $-[0];
        my $tag          = $2;
        my $body_start   = pos($command);
        my $rest         = substr($command, $body_start);
        my $body_end     = length($command);

        if ($rest =~ /\n[ \t]*\Q$tag\E\b/) {
            $body_end = $body_start + $-[0];
        }

        if (is_file_redirect($command, $marker_index)) {
            $result .= substr($command, $cursor, $body_start - $cursor);
            $cursor = $body_end;
        }

        # 本文の中を次のマーカー探索の対象にしない（入れ子の誤検出を避ける）
        pos($command) = $body_end;
    }

    return $result . substr($command, $cursor);
}

sub classify {
    my ($command) = @_;
    my (@labels, %seen);

    for my $rule (@DEFAULT_LABELS, @extra) {
        next unless ref($rule) eq 'HASH' && defined $rule->{pattern} && defined $rule->{label};
        my $matched = eval {
            return 0 unless $command =~ /$rule->{pattern}/i;
            return 0 if defined $rule->{requires} && $command !~ /$rule->{requires}/i;
            return 0 if defined $rule->{unless}   && $command =~ /$rule->{unless}/i;
            1;
        };
        # 設定側の正規表現が不正でも、記録自体は続ける
        next if $@ || !$matched;
        next if $seen{ $rule->{label} }++;
        push @labels, $rule->{label};
    }

    return @labels;
}

my $input = do { local $/; <STDIN> };
$input = '' unless defined $input;

my $payload = eval { JSON::PP->new->utf8->decode($input) };
exit 0 if $@ || ref($payload) ne 'HASH';

my $command = eval { $payload->{tool_input}{command} };
exit 0 unless defined $command && !ref($command);

# 分類は「実行される部分」に対して行い、記録は原文をそのまま残す
my @labels = classify(strip_redirected_heredocs($command));
my @t      = localtime();
my $stamp  = sprintf('%04d/%d/%d %02d:%02d:%02d', $t[5] + 1900, $t[4] + 1, $t[3], $t[2], $t[1], $t[0]);
my $mark   = @labels ? '[!' . join(',', @labels) . ']' : '[ ]';

# 複数行コマンドは字下げして続け、1操作1ブロックで読めるようにする
my $body = join("\n      ", split(/\r?\n/, $command));

eval {
    File::Path::make_path(File::Basename::dirname($log_file));
    open(my $fh, '>>:encoding(UTF-8)', $log_file) or die "cannot open\n";
    print {$fh} "$stamp $mark\n      $body\n\n";
    close($fh);
};
# 記録に失敗しても作業は止めない

exit 0;
