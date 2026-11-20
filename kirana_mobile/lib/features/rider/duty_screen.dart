import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'rider_helpers.dart';
import 'rider_providers.dart';
import 'rider_shell.dart';
import 'rider_widgets.dart';

/// Duty / home tab: presence card, today's stats, live offers, active
/// deliveries and recent completions (web home.js mirror).
class DutyScreen extends ConsumerWidget {
  const DutyScreen({super.key});

  static const int pastLimit = 8;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(riderProfileProvider);
    final jobsAsync = ref.watch(riderJobsProvider);
    final earnings = ref.watch(riderEarningsProvider).valueOrNull;
    final offers = ref.watch(riderOffersProvider);
    final active = ref.watch(riderActiveJobsProvider);
    final past = ref.watch(riderPastJobsProvider);
    final online = profileAsync.valueOrNull?.isOnline ?? false;
    final hint = ref.watch(riderLocationHintProvider);

    if (profileAsync.isLoading && !profileAsync.hasValue) return const LoadingView();
    if (profileAsync.hasError && !profileAsync.hasValue) {
      return ErrorView(
        message: profileAsync.error is ApiException
            ? (profileAsync.error as ApiException).message
            : 'Could not load your rider profile.',
        onRetry: () => ref.read(riderProfileProvider.notifier).refresh(),
      );
    }

    final rider = profileAsync.valueOrNull;
    final today = earnings?.today ?? const EarningsPeriod();
    final homeStore = ref.watch(riderHomeStoreProvider).valueOrNull;
    final jobsLoading = jobsAsync.isLoading && !jobsAsync.hasValue;
    final jobsError = jobsAsync.hasError && !jobsAsync.hasValue;

    return RefreshIndicator(
      color: BB.green,
      onRefresh: () async {
        await Future.wait([
          ref.read(riderProfileProvider.notifier).refresh(),
          ref.read(riderJobsProvider.notifier).refresh(silent: true),
          ref.read(riderEarningsProvider.notifier).refresh(silent: true),
        ]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          if (rider != null) _profileStrip(rider, homeStore?.name ?? ''),
          const SizedBox(height: 10),
          DutyToggleCard(
            online: online,
            busy: ref.watch(riderDutyBusyProvider),
            onChanged: (v) => toggleDuty(context, ref, v),
          ),
          if (online && hint != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: BB.amberTint, borderRadius: BorderRadius.circular(BB.radius)),
              child: Row(children: [
                const Icon(Icons.location_off_outlined, size: 16, color: BB.amber),
                const SizedBox(width: 8),
                Expanded(child: Text(hint, style: const TextStyle(fontSize: 11.5, color: BB.ink))),
              ]),
            ),
          ],
          const SizedBox(height: 12),
          Row(children: [
            RiderStatTile(value: '${today.deliveries}', label: 'Deliveries', accent: BB.greenDeep),
            const SizedBox(width: 8),
            RiderStatTile(value: money(today.totalMinor), label: 'Today'),
            const SizedBox(width: 8),
            RiderStatTile(value: money(today.tipsMinor), label: 'Tips', accent: BB.amber),
          ]),
          if (jobsLoading)
            const Padding(padding: EdgeInsets.all(24), child: LoadingView())
          else if (jobsError)
            ErrorView(
              message: jobsAsync.error is ApiException
                  ? (jobsAsync.error as ApiException).message
                  : 'Could not load delivery jobs.',
              onRetry: () => ref.read(riderJobsProvider.notifier).refresh(),
            )
          else if (!online && active.isEmpty && offers.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: EmptyState(
                icon: Icons.bedtime_outlined,
                title: "You're offline",
                subtitle: 'Go online to start receiving delivery offers from your home store.',
                action: SizedBox(
                  width: 200,
                  child: PrimaryButton(
                    label: 'Go online',
                    icon: Icons.bolt,
                    onPressed: () => toggleDuty(context, ref, true),
                  ),
                ),
              ),
            )
          else ...[
            if (offers.isNotEmpty) ...[
              SectionHeader(title: 'Incoming offers · ${offers.length} live'),
              for (final job in offers) ...[
                OfferCard(job: job),
                const SizedBox(height: 10),
              ],
            ],
            if (active.isNotEmpty) ...[
              const SectionHeader(title: 'Active deliveries'),
              for (final job in active) ...[
                ActiveJobCard(job: job),
                const SizedBox(height: 10),
              ],
            ],
            if (online && offers.isEmpty && active.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 24),
                child: EmptyState(
                  icon: Icons.wifi_tethering,
                  title: 'Waiting for offers…',
                  subtitle: 'Stay online — packed orders near your store are assigned to the nearest rider first.',
                ),
              ),
            if (past.isNotEmpty) ...[
              SectionHeader(
                title: 'Recent deliveries',
                actionLabel: 'Earnings',
                onAction: () => ref.read(riderTabProvider.notifier).state = 2,
              ),
              for (final job in past.take(pastLimit)) ...[
                PastJobRow(job: job),
                const SizedBox(height: 8),
              ],
            ],
          ],
        ],
      ),
    );
  }

  Widget _profileStrip(Rider rider, String homeStoreName) => AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: BB.greenTint, shape: BoxShape.circle),
            child: Text(
              rider.name.isNotEmpty ? rider.name[0].toUpperCase() : 'R',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.greenDeep),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(rider.name.isNotEmpty ? rider.name : 'Rider',
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
              const SizedBox(height: 3),
              Wrap(spacing: 6, runSpacing: 4, children: [
                RiderPill(icon: Icons.delivery_dining, label: rider.vehicle.isNotEmpty ? rider.vehicle : 'Bike'),
                if (homeStoreName.isNotEmpty)
                  RiderPill(icon: Icons.storefront_outlined, label: homeStoreName, bg: BB.blueTint, fg: BB.blue),
              ]),
            ]),
          ),
        ]),
      );
}