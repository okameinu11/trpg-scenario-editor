#!/usr/bin/env perl

# 開発環境基盤(devenv)の導入仕上げ。**導入先リポジトリのルートで**実行する。
#
#   perl scripts/devenv/setup.pl [--hooks perl|node] [--dry-run] [--version]
#
# ## 前提となる運用
#
# 導入は「claude_basement の template/ の中身を、このリポジトリのルートへ手動でコピーする」
# ところから始まる。claude_basement をどこに置いているかは環境ごとに違うため、
# **基盤側の絶対パスに依存する導入スクリプトは用意しない**。
# コピーさえ済んでいれば、あとはこのスクリプトが全部やる。
#
# ## やること
#
#   1. 雛形ファイルを実ファイルにする（既にあるものは触らない）
#   2. .gitignore / .gitattributes に必要な行を追記する（マーカーで冪等）
#   3. フックの実行系(Perl/Node)を選んで .claude/settings.json を置く
#   4. コミットゲートを配線する（core.hooksPath）
#   5. 役目を終えた導入用ファイルを片付ける
#
# 何度実行しても安全。既存ファイルは**一切上書きしない**（プロジェクト固有の
# 内容が必ず入るため、黙って上書きすると設定が消える）。

use strict;
use warnings;
use utf8;
use File::Basename ();
use File::Copy ();
use Cwd ();
use File::Spec ();
use FindBin ();

binmode(STDOUT, ':encoding(UTF-8)');
binmode(STDERR, ':encoding(UTF-8)');

my $DEVENV_DIR = $FindBin::Bin;
my $ROOT       = Cwd::abs_path(File::Spec->catdir($DEVENV_DIR, File::Spec->updir, File::Spec->updir));
my $HOOKS_PATH = '.githooks';
my $MARKER     = '--- devenv (claude_basement) ---';

sub version {
    my $file = File::Spec->catfile($DEVENV_DIR, 'VERSION');
    open(my $fh, '<', $file) or return 'unknown';
    my $v = <$fh>;
    close($fh);
    $v = 'unknown' unless defined $v;
    $v =~ s/\s+\z//;
    return $v;
}

# ---------------------------------------------------------------- 引数

my %args = (hooks => 'perl', dry_run => 0);
{
    my @argv = @ARGV;
    while (@argv) {
        my $arg = shift @argv;
        if    ($arg eq '--hooks')   { $args{hooks} = shift(@argv) || '' }
        elsif ($arg eq '--dry-run') { $args{dry_run} = 1 }
        elsif ($arg eq '--version') { print version() . "\n"; exit 0 }
        elsif ($arg eq '--help' || $arg eq '-h') {
            print "使い方: perl scripts/devenv/setup.pl [--hooks perl|node] [--dry-run] [--version]\n";
            exit 0;
        }
        else {
            print STDERR "不明な引数: $arg\n";
            exit 1;
        }
    }
}

if ($args{hooks} ne 'perl' && $args{hooks} ne 'node') {
    print STDERR "--hooks には perl または node を指定してください。\n";
    exit 1;
}

# ---------------------------------------------------------------- 補助

my (@done, @kept, @notes);

sub path_of { return File::Spec->catfile($ROOT, split(m{/}, $_[0])) }

sub read_bytes {
    my ($rel) = @_;
    open(my $fh, '<:raw', path_of($rel)) or return undef;
    local $/;
    my $bytes = <$fh>;
    close($fh);
    return defined $bytes ? $bytes : '';
}

# 雛形 -> 実ファイル。既にあるものは触らない。
sub materialize {
    my ($source_rel, $dest_rel, $keep_source) = @_;

    return unless -e path_of($source_rel);

    if (-e path_of($dest_rel)) {
        push @kept, "$dest_rel（既存。$source_rel を見ながら手で統合してください）";
        return;
    }

    push @done, "$dest_rel を作成（$source_rel より）";
    return if $args{dry_run};

    File::Copy::copy(path_of($source_rel), path_of($dest_rel))
        or die "コピーに失敗しました: $source_rel -> $dest_rel\n";
    unlink(path_of($source_rel)) unless $keep_source;
}

# 追記。マーカーがあれば何もしない（何度実行しても増えない）。
sub append_snippet {
    my ($source_rel, $dest_rel) = @_;

    my $snippet = read_bytes($source_rel);
    return unless defined $snippet;

    my $current = read_bytes($dest_rel);
    $current = '' unless defined $current;

    if (index($current, $MARKER) >= 0) {
        push @kept, "$dest_rel（追記済み）";
    }
    else {
        push @done, "$dest_rel に追記";
        unless ($args{dry_run}) {
            open(my $fh, '>:raw', path_of($dest_rel)) or die "追記に失敗しました: $dest_rel\n";
            print {$fh} $current . $snippet;
            close($fh);
        }
    }

    # 適用済みの導入用ファイルはリポジトリに残さない
    unlink(path_of($source_rel)) unless $args{dry_run};
}

# ---------------------------------------------------------------- フックの配線

# git のフックは本来 .git/hooks/ に置くだけで動き、設定は要らない。
# それでも core.hooksPath を使うのは、**.git/ が git 管理外**で、
# フック本体をリポジトリに含められないからである（何が走るかがリポジトリを見ても
# 分からず、共有もレビューもできない）。
#
# 設定コマンドを人に手打ちさせる理由は無いのでここで実行する。ただし次の場合は
# **触らない**。黙って既存の仕組みを壊す方が害が大きい。
#   - 既に core.hooksPath が設定されている（Husky等が使っている）
#   - .git/hooks/ にサンプル以外のフックが既にある（設定すると無効化される）

sub git_out {
    my (@cmd) = @_;
    my $output = '';
    if (open(my $pipe, '-|', 'git', '-C', $ROOT, @cmd)) {
        local $/;
        $output = <$pipe>;
        $output = '' unless defined $output;
        close($pipe);
        $output = '' if $? != 0;
    }
    $output =~ s/\s+\z//;
    return $output;
}

sub existing_custom_hooks {
    my $dir = File::Spec->catdir($ROOT, '.git', 'hooks');
    return () unless -d $dir;
    opendir(my $dh, $dir) or return ();
    my @hooks = grep {
        !/\.sample\z/ && $_ ne '.' && $_ ne '..' && -f File::Spec->catfile($dir, $_)
    } readdir($dh);
    closedir($dh);
    return sort @hooks;
}

sub wire_hooks {
    return "gitリポジトリではないため配線しません（`git init` 後に再実行してください）"
        unless -d File::Spec->catdir($ROOT, '.git');

    my $current = git_out('config', '--get', 'core.hooksPath');

    if (length $current) {
        return "設定済み: core.hooksPath = $current" if $current eq $HOOKS_PATH;
        return "core.hooksPath は既に \"$current\" が設定されています（変更しません）。\n"
            . "  $current/pre-commit に次の行を追加してください:\n"
            . "    perl scripts/devenv/check-doc-sync.pl";
    }

    my @custom = existing_custom_hooks();
    if (@custom) {
        return "既存フックがあるため配線しません: .git/hooks/" . join(', ', @custom) . "\n"
            . "  core.hooksPath を設定すると、これらが黙って無効になります。\n"
            . "  既存フックを $HOOKS_PATH/ へ統合してから次を実行してください:\n"
            . "    git config core.hooksPath $HOOKS_PATH";
    }

    return "実行予定: git config core.hooksPath $HOOKS_PATH" if $args{dry_run};

    git_out('config', 'core.hooksPath', $HOOKS_PATH);
    return git_out('config', '--get', 'core.hooksPath') eq $HOOKS_PATH
        ? "配線しました: core.hooksPath = $HOOKS_PATH"
        : "配線に失敗しました。手動で実行してください: git config core.hooksPath $HOOKS_PATH";
}

# ---------------------------------------------------------------- 実行

unless (-e path_of('scripts/devenv/check-doc-sync.pl')) {
    print STDERR "リポジトリのルートで実行してください（scripts/devenv/ が見当たりません）。\n";
    exit 1;
}

# 1. 雛形 -> 実ファイル
#    devenv.config.example.json は書き換えの参照用として原本も残す。
materialize('CLAUDE.template.md',            'CLAUDE.md');
materialize('devenv.config.example.json',    'devenv.config.json', 1);
materialize('devenv.feedback.example.json',  'devenv.feedback.json');

# 2. フックの実行系を選ぶ。両バリアントは残す（あとで切り替えられるように）。
materialize(".claude/settings.hooks-$args{hooks}.json", '.claude/settings.json', 1);

# 3. 追記
append_snippet('gitignore.append',     '.gitignore');
append_snippet('gitattributes.append', '.gitattributes');

# 4. 配線
my $wiring = wire_hooks();

# ---------------------------------------------------------------- 報告

print "devenv セットアップ v" . version() . ($args{dry_run} ? '  [dry-run]' : '') . "\n";
print "対象: $ROOT\n";
print "フックの実行系: $args{hooks}" . ($args{hooks} eq 'perl' ? '（Node不要）' : '（node が PATH に必要）') . "\n";

if (@done) {
    print "\n実施\n";
    print "  - $_\n" for @done;
}
if (@kept) {
    print "\n触れなかったもの\n";
    print "  - $_\n" for @kept;
}

print "\nコミットゲートの配線\n";
print "  $_\n" for split(/\n/, $wiring);

print "\n次にやること\n";
print "  1. devenv.config.json をこのプロジェクトに合わせて書き換える\n";
print "     （配布時の中身はサンプル。そのままだと存在しないパスを見張る死んだルールになる）\n";
print "  2. CLAUDE.md の {{...}} を埋める\n";
print "  3. perl scripts/devenv/check-doc-sync.pl を実行し、エラー無く終わることを確認する\n";
print "  4. 意図的にルールへ引っかけて、コミットが実際に中断されることを確認する\n";
print "     （設定しただけで効いていないゲートは、無いより危険）\n";

print "\n  ここから先は Claude Code に任せられます。\n";
print "  このリポジトリで Claude Code を開き『devenv をセットアップして』と伝えてください\n";
print "  （.claude/skills/devenv-setup が上の 1〜4 を進めます）。\n";

print "\n注意: core.hooksPath はローカル設定なので clone には付いてきません。\n";
print "      README に `git config core.hooksPath $HOOKS_PATH` を書き添えてください。\n";
