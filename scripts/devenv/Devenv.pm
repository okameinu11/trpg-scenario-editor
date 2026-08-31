package Devenv;

# devenv共通ライブラリ。
#
# ## なぜ Perl か
#
# pre-commitフックの前提を「git があること」だけに揃えるため。
# git はこの基盤の主機能（コミットゲート）に元々必須であり、
# Git for Windows は Perl を同梱している。Linux/macOS でも Perl はほぼ確実に存在する。
# JSON解析に使う JSON::PP は Perl 5.14 以降のコアモジュールなので追加インストールも要らない。
#
# つまり Node・npm・python・jq のいずれも無い環境でゲートが動く。
#
# ## 文字コードの扱い
#
# 設定ファイルにもファイル名にも日本語が入りうる。
# git の出力・設定ファイルはどちらもUTF-8バイト列として読み、文字列にデコードしてから比較する。
# デコードせずに比較すると、日本語パスのルールが黙って一致しなくなる。

use strict;
use warnings;
use utf8;
use JSON::PP ();
use File::Spec ();
use Encode ();
use Exporter 'import';

our @EXPORT_OK = qw(
    load_config
    audit_log_path
    staged_files
    staged_diff
    added_lines
    glob_match
    glob_match_any
    filter_by_globs
    tracked_files_matching
    setup_output_encoding
);

my $CONFIG_FILE = 'devenv.config.json';

# ---------------------------------------------------------------- 出力

# 日本語を含むメッセージを出すため、標準出力・標準エラーをUTF-8にする。
# これをしないと "Wide character in print" 警告が出て、警告文自体がノイズになる。
sub setup_output_encoding {
    binmode(STDOUT, ':encoding(UTF-8)');
    binmode(STDERR, ':encoding(UTF-8)');
}

# ---------------------------------------------------------------- 外部コマンド

# git の呼び出し。標準エラーは捨てる。
#
# gitリポジトリでない・初回コミット前などに git が出すメッセージをそのまま流すと、
# 「何もしないのが正常」な場面でエラーが出ているように見えて紛らわしいため。
sub _run {
    my (@cmd) = @_;

    open(my $saved_err, '>&', \*STDERR) or return '';
    open(STDERR, '>', File::Spec->devnull);

    my $output = '';
    if (open(my $pipe, '-|', @cmd)) {
        local $/;
        $output = <$pipe>;
        $output = '' unless defined $output;
        close($pipe);
        $output = '' if $? != 0;
    }

    open(STDERR, '>&', $saved_err);
    close($saved_err);

    return Encode::decode('UTF-8', $output, Encode::FB_DEFAULT);
}

# ---------------------------------------------------------------- 設定

sub _parent_dir {
    my ($dir) = @_;
    my @parts = File::Spec->splitdir($dir);
    pop @parts;
    return '' unless @parts;
    my $parent = File::Spec->catdir(@parts);
    return $parent;
}

sub _find_config_file {
    my ($start) = @_;
    my $dir = File::Spec->rel2abs(defined $start ? $start : '.');

    for (;;) {
        my $candidate = File::Spec->catfile($dir, $CONFIG_FILE);
        return $candidate if -e $candidate;

        my $parent = _parent_dir($dir);
        return undef if !length($parent) || $parent eq $dir;
        $dir = $parent;
    }
}

sub _default_config {
    return {
        project          => { name => '', language => 'ja' },
        syncRules        => [],
        guardedCommands  => [],
        auditLog         => { enabled => JSON::PP::true, file => '.claude/logs/agent-actions.log', extraLabels => [] },
        feedback         => { basementPath => '', inboxDir => 'improvements/inbox' },
    };
}

# 設定が見つからない場合はデフォルト（＝チェック無し）で返す。
# 「導入したがまだ設定していない」状態でコミットが止まらないようにするため。
# 設定が壊れている場合だけは黙って無視せず知らせる（チェックが効かないまま気づかない状態を避ける）。
sub load_config {
    my ($start) = @_;

    my $file = _find_config_file($start);
    my $config = _default_config();

    # 設定を読めたかどうかは呼び出し側に伝える。読めなかったときに保護を
    # 縮退させる（guard-commands の BASELINE）判断がこれに乗っている。
    $config->{configError} = 0;

    if (!defined $file) {
        $config->{configPath} = undef;
        $config->{rootDir}    = File::Spec->rel2abs(defined $start ? $start : '.');
        return $config;
    }

    my $parsed = {};
    if (open(my $fh, '<:raw', $file)) {
        local $/;
        my $bytes = <$fh>;
        close($fh);
        my $decoded = eval { JSON::PP->new->utf8->decode(defined $bytes ? $bytes : '{}') };
        if ($@ || ref($decoded) ne 'HASH') {
            my $reason = $@ || 'オブジェクトではありません';
            $reason =~ s/\s+\z//;
            print STDERR "[devenv] $CONFIG_FILE の読み込みに失敗しました: $reason\n";
            $config->{configError} = 1;
        }
        else {
            $parsed = $decoded;
        }
    }
    else {
        print STDERR "[devenv] $CONFIG_FILE を開けませんでした: $file\n";
        $config->{configError} = 1;
    }

    for my $key (keys %$parsed) {
        $config->{$key} = $parsed->{$key};
    }
    # ネストした既定値は個別にマージする（片方だけ書かれた設定で落ちないように）
    for my $section (qw(auditLog feedback project)) {
        next unless ref($parsed->{$section}) eq 'HASH';
        my %merged = (%{ _default_config()->{$section} }, %{ $parsed->{$section} });
        $config->{$section} = \%merged;
    }

    my (undef, $dir, undef) = File::Spec->splitpath($file);
    $dir =~ s{[/\\]\z}{};
    $config->{configPath} = $file;
    $config->{rootDir}    = length($dir) ? $dir : File::Spec->curdir;

    return $config;
}

# ---------------------------------------------------------------- 実行記録の書き出し先

# 記録先のパスを決める。既定では日付ごとにファイルを分ける。
#
# ## なぜ分けるか
#
# 1ファイルに追記し続けると、オートモードでは実測で 200KB/日 近く増える。
# 半月で数MB・数万行に達し、「リスクのある操作が無かったか」を点検するのに
# 毎回その全体を相手にすることになる。点検は日付で範囲を切る作業なので、
# ファイル境界を日付に合わせておくと「前回の点検日より新しいファイルだけ見る」で済む。
#
# ## 日付をどの時計で決めるか
#
# **記録本文のタイムスタンプと同じローカル時刻で決める。**
# ここだけUTCで決めると、日本時間の朝9時までの記録が前日のファイルに入り、
# ファイル名と中身の日付が食い違う。タイムゾーンを設定で持たせないのは、
# 本文と同じ時計を使う限り食い違いが原理的に起きないためである。
#
#   .claude/logs/agent-actions.log
#     -> .claude/logs/2026-08/agent-actions-2026-08-31.log
#
# rotate: "daily"（既定） / "none"（従来どおり1ファイル）
sub audit_log_path {
    my ($config) = @_;

    my $audit  = ref($config->{auditLog}) eq 'HASH' ? $config->{auditLog} : {};
    my $rel    = defined $audit->{file} ? $audit->{file} : '.claude/logs/agent-actions.log';
    my $rotate = defined $audit->{rotate} ? $audit->{rotate} : 'daily';
    my $root   = defined $config->{rootDir} ? $config->{rootDir} : File::Spec->curdir;

    my $path = File::Spec->catfile($root, split(m{/}, $rel));
    return $path unless $rotate eq 'daily';

    my @t     = localtime();
    my $month = sprintf('%04d-%02d', $t[5] + 1900, $t[4] + 1);
    my $day   = sprintf('%04d-%02d-%02d', $t[5] + 1900, $t[4] + 1, $t[3]);

    my ($volume, $dir, $base) = File::Spec->splitpath($path);
    $dir =~ s{[/\\]+\z}{};

    my $ext = '';
    if ($base =~ s{(\.[^.\\/]*)\z}{}) {
        $ext = $1;
    }

    return File::Spec->catpath($volume, File::Spec->catdir($dir, $month), "$base-$day$ext");
}

# ---------------------------------------------------------------- git

# core.quotepath=false を必ず付ける。これが無いと日本語ファイル名が
# octalエスケープ("docs/06_DB\350\250...")で返り、設定に書いたパスと比較できなくなる。
sub staged_files {
    my ($diff_filter) = @_;
    $diff_filter = 'ACMR' unless defined $diff_filter && length $diff_filter;

    my $output = _run(
        'git', '-c', 'core.quotepath=false',
        'diff', '--cached', '--name-only', "--diff-filter=$diff_filter"
    );

    my @files;
    for my $line (split /\n/, $output) {
        $line =~ s/\A\s+//;
        $line =~ s/\s+\z//;
        push @files, $line if length $line;
    }
    return @files;
}

sub staged_diff {
    my ($file) = @_;
    return _run('git', 'diff', '--cached', '--', $file);
}

# 差分のうち追加行（+++ を除く）だけを返す。
sub added_lines {
    my ($file) = @_;
    return grep { /\A\+/ && !/\A\+\+\+/ } split /\n/, staged_diff($file);
}

# ---------------------------------------------------------------- glob

# 依存を増やさないための最小実装。対応する記法は3つに絞る。
#
#   *   … / を跨がない任意の文字列
#   **  … / を跨ぐ任意の文字列（`**` の直後が `/` なら「0階層以上」）
#   ?   … / 以外の1文字
#
# `**/` を0階層以上として扱わないと、`src/**/*.ts` が `src/a.ts` に当たらず、
# 直下のファイルだけ検知漏れするという分かりにくい穴になる。

my %REGEX_SPECIAL = map { $_ => 1 } split(//, '.+^${}()|[]\\/');
my %regex_cache;

sub _glob_to_regex {
    my ($pattern) = @_;
    my @chars = split //, $pattern;
    my $source = '';

    for (my $i = 0; $i < @chars; $i++) {
        my $char = $chars[$i];

        if ($char eq '*') {
            my $next = defined $chars[$i + 1] ? $chars[$i + 1] : '';
            if ($next eq '*') {
                $i++;
                my $after = defined $chars[$i + 1] ? $chars[$i + 1] : '';
                if ($after eq '/') {
                    $i++;
                    $source .= '(?:.*/)?';
                }
                else {
                    $source .= '.*';
                }
            }
            else {
                $source .= '[^/]*';
            }
            next;
        }

        if ($char eq '?') {
            $source .= '[^/]';
            next;
        }

        $source .= $REGEX_SPECIAL{$char} ? "\\$char" : $char;
    }

    return qr/\A$source\z/;
}

sub glob_match {
    my ($path, $pattern) = @_;
    $regex_cache{$pattern} = _glob_to_regex($pattern) unless exists $regex_cache{$pattern};
    return $path =~ $regex_cache{$pattern} ? 1 : 0;
}

sub glob_match_any {
    my ($path, $patterns) = @_;
    return 0 unless ref($patterns) eq 'ARRAY' && @$patterns;
    for my $pattern (@$patterns) {
        return 1 if glob_match($path, $pattern);
    }
    return 0;
}

sub filter_by_globs {
    my ($files, $include, $exclude) = @_;
    $include = [] unless ref($include) eq 'ARRAY';
    $exclude = [] unless ref($exclude) eq 'ARRAY';

    my @result;
    for my $file (@$files) {
        next if @$include && !glob_match_any($file, $include);
        next if @$exclude && glob_match_any($file, $exclude);
        push @result, $file;
    }
    return @result;
}

# ---------------------------------------------------------------- ファイル走査

# 追跡下のファイルのうちglobに当たるものを返す（リポジトリルート相対）。
#
# git の差分ではなく作業ツリー全体を見るのは、「改名で壊れた参照」のように
# **今回の変更に含まれていないファイル側が壊れる**問題を扱うため。
# 差分だけを見ていると、壊れた側が別コミットにあるので永久に検知できない。
#
# ディレクトリを自前で歩かず git ls-files を使う理由は3つある。
#   - .gitignore が効くので node_modules 等を除外する仕組みを持たなくてよい
#     （毎コミットで巨大ディレクトリを走査するゲートは遅く、遅いゲートは外される）
#   - ファイル名の文字コードを git が UTF-8 に正規化してくれる
#     （readdir が返すバイト列の解釈は環境依存で、日本語名が黙って壊れる）
#   - 追跡されていないファイルは参照先として当てにならない
sub tracked_files_matching {
    my ($include, $exclude) = @_;
    return () unless ref($include) eq 'ARRAY' && @$include;

    my $output = _run('git', '-c', 'core.quotepath=false', 'ls-files');

    my @found;
    for my $line (split /\n/, $output) {
        $line =~ s/\A\s+//;
        $line =~ s/\s+\z//;
        next unless length $line;
        next unless glob_match_any($line, $include);
        next if ref($exclude) eq 'ARRAY' && @$exclude && glob_match_any($line, $exclude);
        push @found, $line;
    }

    return sort @found;
}

1;
