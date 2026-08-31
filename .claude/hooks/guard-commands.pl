#!/usr/bin/env perl

# PreToolUse hook (Bash): 実行してはいけないコマンドを、実行前に拒否する。
#
# guard-commands.js と同じことをする Perl 版。
#
# ## なぜ必要か
#
# 「本番DBへ直接適用しない」「force pushしない」といった取り決めをCLAUDE.mdに
# 書いても、それはお願いでしかない。取り返しのつかない操作については、
# ドキュメントとは別に機械的な最終防衛線を置く。
#
# 遮断対象は devenv.config.json の guardedCommands で定義する。
# pattern のほかに requires（これも満たすときだけ遮断）と
# unless（これに当てはまるときは遮断しない）を書ける。
#
# ## 誤爆させないための工夫
#
# コミットメッセージ本文でコマンド名に言及しただけのケースを実行と誤認すると、
# 正当な作業が止まって信頼を失う。そこで
# heredoc本文内・バッククォートで囲まれた出現は無視する。
#
# それでも1本の pattern では書き分けられない例外はある（「秘密ファイルは止めたいが
# テンプレートのサンプルは通す」など）。そのための requires / unless で、
# 語彙は auditLog.extraLabels と同じにしてある。

use strict;
use warnings;
use utf8;
use File::Spec ();
use FindBin ();
use JSON::PP ();
use lib File::Spec->catdir($FindBin::Bin, File::Spec->updir, File::Spec->updir, 'scripts', 'devenv');
use Devenv qw(load_config);

my $config     = load_config();
my @configured = ref($config->{guardedCommands}) eq 'ARRAY' ? @{ $config->{guardedCommands} } : ();

# 設定が読めなかったときの最低限の遮断。
#
# ## なぜコード側に持つのか
#
# 遮断ルールを全て設定に置くと、設定の可用性が保護の前提になる。
# devenv.config.json にJSONの記述ミスがあるだけで guardedCommands は空になり、
# 何も遮断しないままコマンドが通る。知らせるのが stderr の1行だけだと
# 「止まらなかった＝安全なコマンドだった」と誤読させる。
# JSONに正規表現を書く以上、記述ミスは現実に起きる。
#
# ここに置くのはプロジェクトに依存せず、実行したら戻せないものだけに絞る。
# 設定を持つプロジェクトはこちらを使わないので、常用の遮断は設定側に書く
# （設定を持てば上書きできる＝逃げ道が残る、という関係を壊さないため）。
my @BASELINE = (
    {
        id      => 'git-force-push',
        pattern => 'git\s+push\s+(?:[^|;&]*\s)?(?:--force(?!-with-lease)|-f)\b',
        reason  => '共有ブランチの履歴を壊す可能性があります。どうしても必要なら --force-with-lease を使い、ユーザーに確認してから実行してください。',
    },
    {
        id      => 'rm-rf-root',
        pattern => '\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:/|~|\$HOME)(?:\s|;|&|\||$)',
        reason  => 'ファイルシステムのルートまたはホームディレクトリを再帰削除しようとしています。対象パスを具体的に指定し直してください。',
    },
);

my $degraded = (!defined $config->{configPath} || $config->{configError}) ? 1 : 0;
my @guarded  = @configured ? @configured : @BASELINE;

if ($degraded) {
    binmode(STDERR, ':encoding(UTF-8)');
    print STDERR "[devenv] devenv.config.json を読めなかったため、最低限の遮断のみで動作しています"
        . "（guard-commands の BASELINE）。設定を直してください。\n";
}

# heredoc（<<TAG … TAG）の本文範囲を求める。
sub find_heredoc_ranges {
    my ($command) = @_;
    my @ranges;

    while ($command =~ /<<-?\s*(['"]?)(\w+)\1/g) {
        my $tag        = $2;
        my $body_start = pos($command);
        my $rest       = substr($command, $body_start);
        my $body_end   = length($command);

        if ($rest =~ /\n[ \t]*\Q$tag\E\b/) {
            $body_end = $body_start + $-[0];
        }
        push @ranges, [ $body_start, $body_end ];
    }

    return \@ranges;
}

sub is_inside_range {
    my ($index, $ranges) = @_;
    for my $range (@$ranges) {
        return 1 if $index >= $range->[0] && $index < $range->[1];
    }
    return 0;
}

sub is_backtick_quoted {
    my ($command, $index, $length) = @_;
    return 0 if $index == 0;
    return 0 unless substr($command, $index - 1, 1) eq '`';
    return substr($command, $index + $length, 1) eq '`' ? 1 : 0;
}

# 「文字列としての言及」ではなく「実際の実行」に見える出現があるか。
sub has_real_invocation {
    my ($command, $pattern) = @_;
    my $ranges = find_heredoc_ranges($command);

    while ($command =~ /$pattern/gi) {
        my $start  = $-[0];
        my $length = $+[0] - $-[0];
        next if is_inside_range($start, $ranges);
        next if is_backtick_quoted($command, $start, $length);
        return 1;
    }
    return 0;
}

# requires / unless はコマンド全体に対して判定する（例外は文脈で決まるため）。
sub conditions_satisfied {
    my ($command, $rule) = @_;
    return 0 if defined $rule->{requires} && $command !~ /$rule->{requires}/i;
    return 0 if defined $rule->{unless}   && $command =~ /$rule->{unless}/i;
    return 1;
}

my $input = do { local $/; <STDIN> };
$input = '' unless defined $input;

my $payload = eval { JSON::PP->new->utf8->decode($input) };
exit 0 if $@ || ref($payload) ne 'HASH';

my $command = eval { $payload->{tool_input}{command} };
exit 0 unless defined $command && !ref($command);

for my $rule (@guarded) {
    next unless ref($rule) eq 'HASH' && defined $rule->{pattern};

    my $hit = eval { has_real_invocation($command, $rule->{pattern}) && conditions_satisfied($command, $rule) };
    next if $@ || !$hit;

    my $id     = defined $rule->{id}     ? $rule->{id}     : 'guarded-command';
    my $reason = defined $rule->{reason} ? $rule->{reason} : 'devenv.config.json の guardedCommands を参照してください。';

    my $response = {
        hookSpecificOutput => {
            hookEventName            => 'PreToolUse',
            permissionDecision       => 'deny',
            permissionDecisionReason =>
                "[$id] このコマンドはプロジェクトの方針により実行を禁止しています。\n$reason",
        },
    };

    binmode(STDOUT, ':raw');
    print JSON::PP->new->utf8->canonical(0)->encode($response);
    exit 0;
}

exit 0;
