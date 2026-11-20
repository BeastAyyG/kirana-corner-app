import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'rider_helpers.dart';
import 'rider_providers.dart';
import 'rider_widgets.dart';

/// Earnings tab: today / week / all-time payout cards plus delivered-job
/// history (web earnings.js mirror). All amounts are integer paise.
class EarningsScreen extends ConsumerWidget {
  const EarningsScreen({super.key});

  static const int historyLimit = 30;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final earningsAsync = ref.watch(riderEarningsProvider);
    final jobsAsync = ref.watch(riderJobsProvider);
    final past = ref.watch(riderPastJobsProvider);

    if (earningsAsync.isLoading && !earningsAsync.hasValue) return const LoadingView();
    if (earningsAsync.hasError && !earningsAsync.hasValue) {
      return ErrorView(
        message: earningsAsync.error is ApiException
            ? (earningsAsync.error as ApiException).message
            : 'Could not load your earnings.',
        onRetry: () => ref.read(riderEarningsProvider.notifier).refresh(),
      );
    }

    final earnings = earningsAsync.valueOrNull ?? const RiderEarnings();
    final history = past.take(historyLimit).toList();
    final jobsLoading = jobsAsync.isLoading && !jobsAsync.hasValue;

    return RefreshIndicator(
      color: BB.green,
      onRefresh: () async {
        await Future.wait([
          ref.read(riderEarningsProvider.notifier).refresh(silent: true),
          ref.read(riderJobsProvider.notifier).refresh(silent: true),
        ]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          _PeriodCard(label: 'Today', icon: Icons.bolt, period: earnings.today, note: 'Earned since midnight', hero: true),
          const SizedBox(height: 10),
          _PeriodCard(label: 'This week', icon: Icons.schedule, period: earnings.week, note: 'Last 7 days'),
          const SizedBox(height: 10),
          _PeriodCard(label: 'All time', icon: Icons.account_balance_wallet_outlined, period: earnings.allTime, note: 'Since you joined'),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: BB.blueTint, borderRadius: BorderRadius.circular(BB.radius)),
            child: const Row(children: [
              Icon(Icons.payments_outlined, size: 16, color: BB.blue),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'COD cash you collect is deposited at your home store — it is tracked here but not part of your payout.',
                  style: TextStyle(fontSize: 11.5, color: BB.ink),
                ),
              ),
            ]),
          ),
          SectionHeader(title: 'Delivery history · ${history.length} shown'),
          if (jobsLoading)
            const LoadingView()
          else if (history.isEmpty)
            EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'No deliveries yet',
              subtitle: 'Complete your first delivery and it will show up here with its payout.',
              action: SizedBox(
                width: 200,
                child: PrimaryButton(
                  label: 'Find jobs',
                  icon: Icons.delivery_dining,
                  onPressed: () => ref.read(riderTabProvider.notifier).state = 1,
                ),
              ),
            )
          else
            for (final job in history) ...[
              PastJobRow(job: job, showTip: true),
              const SizedBox(height: 8),
            ],
        ],
      ),
    );
  }
}

class _PeriodCard extends StatelessWidget {
  final String label;
  final IconData icon;
  final EarningsPeriod period;
  final String note;
  final bool hero;
  const _PeriodCard({required this.label, required this.icon, required this.period, required this.note, this.hero = false});

  @override
  Widget build(BuildContext context) {
    final p = period;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: hero ? BB.greenTint : BB.card,
        borderRadius: BorderRadius.circular(BB.radiusLg),
        border: Border.all(color: hero ? BB.green.withValues(alpha: .4) : BB.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, size: 17, color: hero ? BB.greenDeep : BB.sub),
          const SizedBox(width: 6),
          Expanded(
            child: Text(label,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: hero ? BB.greenDeep : BB.ink)),
          ),
          RiderPill(
            icon: Icons.delivery_dining,
            label: '${p.deliveries} ${p.deliveries == 1 ? 'delivery' : 'deliveries'}',
            bg: hero ? BB.green.withValues(alpha: .18) : BB.bg,
            fg: hero ? BB.greenDeep : BB.sub,
          ),
        ]),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
          Text(money(p.totalMinor),
              style: TextStyle(fontSize: hero ? 28 : 22, fontWeight: FontWeight.w800, color: hero ? BB.greenDeep : BB.ink)),
          const SizedBox(width: 8),
          Text(note, style: const TextStyle(fontSize: 11, color: BB.sub)),
        ]),
        const SizedBox(height: 10),
        InfoRow(label: 'Delivery payout', value: money(p.payoutMinor)),
        InfoRow(label: 'Customer tips', value: money(p.tipsMinor), valueColor: BB.saveInk),
        InfoRow(label: 'COD cash collected', value: money(p.cashCollectedMinor), valueColor: BB.amber),
      ]),
    );
  }
}