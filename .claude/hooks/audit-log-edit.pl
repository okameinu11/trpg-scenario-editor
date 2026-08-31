#!/usr/bin/env perl

# PreToolUse hook (Write|Edit|NotebookEdit): ファイルの作成・編集を記録する。
#
# audit-log-edit.js と同じことをする Perl 版。
#
# 変更内容そのものは git で追えるが、
#   - まだコミットしていない編集
#   - コミット前に上書きされて消えた中間状態
# は git に残らない。「いつ・どのファイルを触ったか」の時系列だけでも残しておくと、
# あとから経緯を追える。
#
# 何もブロックしない（常に exit 0）。差分は記録しない（肥大化するため。
# 内容の確認は git diff / git show を使う）。
#
# 記録先は audit-log.pl と同じファイル（既定では日付ごとに分かれる）。

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

my $config = load_config();
my $audit  = ref($config->{auditLog}) eq 'HASH' ? $config->{auditLog} : {};
exit 0 if exists $audit->{enabled} && !$audit->{enabled};

my $log_file = audit_log_path($config);

my $input = do { local $/; <STDIN> };
$input = '' unless defined $input;

my $payload = eval { JSON::PP->new->utf8->decode($input) };
exit 0 if $@ || ref($payload) ne 'HASH';

my $tool   = $payload->{tool_name};
my $target = eval { $payload->{tool_input}{file_path} };
$target = eval { $payload->{tool_input}{notebook_path} } unless defined $target;
exit 0 unless defined $target && !ref($target);

# 新規作成か上書きかは、この時点でのファイルの有無で判定する
my $kind = (defined $tool && $tool eq 'Write')
    ? (-e $target ? 'WRITE(上書き)' : 'WRITE(新規)')
    : (defined $tool ? $tool : 'EDIT');

my @t     = localtime();
my $stamp = sprintf('%04d/%d/%d %02d:%02d:%02d', $t[5] + 1900, $t[4] + 1, $t[3], $t[2], $t[1], $t[0]);

eval {
    File::Path::make_path(File::Basename::dirname($log_file));
    open(my $fh, '>>:encoding(UTF-8)', $log_file) or die "cannot open\n";
    print {$fh} "$stamp [FILE:$kind] $target\n\n";
    close($fh);
};
# 記録に失敗しても作業は止めない

exit 0;
