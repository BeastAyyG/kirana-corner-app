import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'rider_providers.dart';
import 'rider_widgets.dart';

/// Jobs / offers tab: filterable list of offers, active deliveries and
/// completed history with accept/decline actions on live offers.
class JobsScreen extends ConsumerStatefulWidget {
  const JobsScreen({super.key});
  @override
  ConsumerState<JobsScreen> createState() => _JobsScreenState();
}

class _JobsScreenState extends ConsumerState<JobsScreen> {
  static const List<String> filters = ['All', 'Offers', 'Active', 'Completed'];
  int _filter = 0;

  @override
  Widget build(BuildContext context) {
    final jobsAsync = ref.watch(riderJobsProvider);
    final offers = ref.watch(riderOffersProvider);
    final active = ref.watch(riderActiveJobsProvider);
    final past = ref.watch(riderPastJobsProvider);

    final counts = [offers.length + active.length + past.length, offers.length, active.length, past.length];

    Widget list;
    if (jobsAsync.isLoading && !jobsAsync.hasValue) {
      list = const LoadingView();
    } else if (jobsAsync.hasError && !jobsAsync.hasValue) {
      list = ErrorView(
        message: jobsAsync.error is ApiException
            ? (jobsAsync.error as ApiException).message
            : 'Could not load delivery jobs.',
        onRetry: () => ref.read(riderJobsProvider.notifier).refresh(),
      );
    } else {
      list = RefreshIndicator(
        color: BB.green,
        onRefresh: () => ref.read(riderJobsProvider.notifier).refresh(silent: true),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
          children: [
            if (_filter == 0 || _filter == 1) ...[
              if (offers.isNotEmpty) ...[
                SectionHeader(title: 'Incoming offers · ${offers.length} live'),
                for (final job in offers) ...[OfferCard(job: job), const SizedBox(height: 10)],
              ] else if (_filter == 1)
                const _JobsEmpty(
                  icon: Icons.wifi_tethering,
                  title: 'No live offers',
                  subtitle: 'Stay online — new offers appear here the moment a packed order is assigned to you.',
                ),
            ],
            if (_filter == 0 || _filter == 2) ...[
              if (active.isNotEmpty) ...[
                const SectionHeader(title: 'Active deliveries'),
                for (final job in active) ...[ActiveJobCard(job: job), const SizedBox(height: 10)],
              ] else if (_filter == 2)
                const _JobsEmpty(
                  icon: Icons.delivery_dining,
                  title: 'No active deliveries',
                  subtitle: 'Accept an offer to start a delivery. It will show up here with pickup and drop steps.',
                ),
            ],
            if (_filter == 0 || _filter == 3) ...[
              if (past.isNotEmpty) ...[
                SectionHeader(title: 'Completed · ${past.length}'),
                for (final job in past) ...[PastJobRow(job: job, showTip: true), const SizedBox(height: 8)],
              ] else if (_filter == 3)
                const _JobsEmpty(
                  icon: Icons.task_alt,
                  title: 'No completed deliveries',
                  subtitle: 'Finish your first delivery and it will appear here with its payout.',
                ),
            ],
            if (_filter == 0 && offers.isEmpty && active.isEmpty && past.isEmpty)
              const _JobsEmpty(
                icon: Icons.inbox_outlined,
                title: 'No jobs yet',
                subtitle: 'Go online from the Duty tab to start receiving delivery offers near your home store.',
              ),
          ],
        ),
      );
    }

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        child: Row(
          children: List.generate(filters.length, (i) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text('${filters[i]}${counts[i] > 0 ? ' · ${counts[i]}' : ''}'),
              selected: _filter == i,
              onSelected: (_) => setState(() => _filter = i),
              selectedColor: BB.greenTint,
              backgroundColor: BB.card,
              side: BorderSide(color: _filter == i ? BB.green : BB.line),
              labelStyle: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: _filter == i ? BB.greenDeep : BB.sub,
              ),
              showCheckmark: false,
            ),
          )),
        ),
      ),
      Expanded(child: list),
    ]);
  }
}

class _JobsEmpty extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _JobsEmpty({required this.icon, required this.title, required this.subtitle});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 32),
        child: EmptyState(icon: icon, title: title, subtitle: subtitle),
      );
}