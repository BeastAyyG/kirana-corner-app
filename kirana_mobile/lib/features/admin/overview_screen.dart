// Operations overview: today's KPIs in a 2-column mobile grid, orders-by-status
// bars, users by role and a store snapshot. Mirrors the web overview view.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';

const _allStatuses = ['placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered', 'cancelled'];

const _statusBarColors = {
  'placed': BB.amber,
  'packing': BB.amber,
  'packed': BB.blue,
  'rider_assigned': BB.blue,
  'picked_up': BB.etaBlue,
  'delivered': BB.green,
  'cancelled': BB.red,
};

class OverviewScreen extends ConsumerWidget {
  const OverviewScreen({super.key});

  void _refresh(WidgetRef ref) {
    ref.invalidate(adminOverviewProvider);
    ref.invalidate(adminStoresProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(adminOverviewProvider);
    return Column(children: [
      AdminHeading(
        title: 'Operations overview',
        subtitle: DateFormatHelper.todayLine(),
        actions: [RefreshAction(onPressed: () => _refresh(ref))],
      ),
      Expanded(
        child: overview.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(message: adminErrorMessage(e, 'Could not load the overview'), onRetry: () => _refresh(ref)),
          data: (ov) => RefreshIndicator(
            color: BB.green,
            onRefresh: () async {
              _refresh(ref);
              await ref.read(adminOverviewProvider.future);
            },
            child: _OverviewBody(overview: ov),
          ),
        ),
      ),
    ]);
  }
}

/// Date line helper kept separate so the widget tree stays declarative.
class DateFormatHelper {
  static String todayLine() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    final now = DateTime.now();
    return '${days[now.weekday - 1]}, ${now.day} ${months[now.month - 1]} ${now.year}';
  }
}

class _OverviewBody extends ConsumerWidget {
  final Map<String, dynamic> overview;
  const _OverviewBody({required this.overview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = rawMap(overview['today']);
    final byStatus = rawMap(today['orders_by_status']);
    final roles = rawMap(overview['users_by_role']);
    final totalOrders = _allStatuses.fold<int>(0, (n, s) => n + rawInt(byStatus[s]));
    final delivered = rawInt(today['delivered']);
    final cancelled = rawInt(byStatus['cancelled']);
    final liveOrders = totalOrders - delivered - cancelled;
    final pendingPayments = rawInt(overview['pending_payments']);
    final ridersOnline = rawInt(overview['riders_online']);
    final storesOpen = rawInt(overview['stores_open']);
    final storesAsync = ref.watch(adminStoresProvider);
    final storeCount = storesAsync.valueOrNull?.length ?? 0;
    final totalAccounts = roles.values.fold<int>(0, (n, v) => n + rawInt(v));

    final cards = <Widget>[
      _KpiCard(icon: Icons.payments_rounded, tone: BB.greenTint, toneFg: BB.greenDeep, label: 'GMV today', value: money(rawInt(today['gmv_minor'])), note: '$delivered delivered orders'),
      _KpiCard(icon: Icons.check_circle_rounded, tone: BB.saveTint, toneFg: BB.saveInk, label: 'Delivered', value: '$delivered', note: 'completed today'),
      _KpiCard(icon: Icons.bolt_rounded, tone: BB.blueTint, toneFg: BB.blue, label: 'Avg delivery', value: '${_avgMinutes(today['avg_delivery_minutes'])} min', note: 'placed → delivered'),
      _KpiCard(icon: Icons.two_wheeler_rounded, tone: BB.greenTint, toneFg: BB.greenDeep, label: 'Riders online', value: '$ridersOnline', note: '${rawInt(roles['rider'])} riders on staff'),
      _KpiCard(icon: Icons.storefront_rounded, tone: BB.amberTint, toneFg: BB.amber, label: 'Stores open', value: '$storesOpen', note: '$storeCount in the network'),
      _KpiCard(
        icon: Icons.account_balance_wallet_rounded,
        tone: pendingPayments > 0 ? BB.redTint : BB.blueTint,
        toneFg: pendingPayments > 0 ? BB.red : BB.blue,
        label: 'Pending payments',
        value: '$pendingPayments',
        note: pendingPayments > 0 ? 'needs attention' : 'all settled',
      ),
      _KpiCard(icon: Icons.receipt_long_rounded, tone: BB.blueTint, toneFg: BB.blue, label: 'Orders today', value: '$totalOrders', note: '$liveOrders in flight right now'),
    ];

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        LayoutBuilder(builder: (context, constraints) {
          final width = (constraints.maxWidth - 10) / 2;
          return Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [for (final card in cards) SizedBox(width: width, child: card)],
          );
        }),
        const SizedBox(height: 14),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _cardTitle('Orders by status', '$totalOrders today'),
            const SizedBox(height: 8),
            for (final status in _allStatuses) _StatusRow(status: status, count: rawInt(byStatus[status]), maxCount: _maxCount(byStatus)),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _cardTitle('Users by role', '$totalAccounts accounts'),
            const SizedBox(height: 10),
            Row(children: [
              _RoleTile(icon: Icons.person_rounded, tone: BB.blueTint, fg: BB.blue, label: 'Customers', count: rawInt(roles['customer'])),
              _RoleTile(icon: Icons.inventory_2_rounded, tone: BB.amberTint, fg: BB.amber, label: 'Pickers', count: rawInt(roles['picker'])),
              _RoleTile(icon: Icons.two_wheeler_rounded, tone: BB.greenTint, fg: BB.greenDeep, label: 'Riders', count: rawInt(roles['rider'])),
              _RoleTile(icon: Icons.shield_rounded, tone: BB.saveTint, fg: BB.saveInk, label: 'Admins', count: rawInt(roles['admin'])),
            ]),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _cardTitle('Store snapshot', ''),
            const SizedBox(height: 6),
            storesAsync.when(
              loading: () => const Padding(padding: EdgeInsets.all(12), child: LoadingView()),
              error: (e, _) => Text(adminErrorMessage(e, 'Could not load stores'), style: const TextStyle(color: BB.sub, fontSize: 13)),
              data: (stores) => stores.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      child: Text('No stores yet. Add your first store to start taking orders.', style: TextStyle(color: BB.sub, fontSize: 13)),
                    )
                  : Column(children: [
                      for (final s in stores)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 7),
                          child: Row(children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(s.store.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: BB.ink)),
                                const SizedBox(height: 2),
                                Text(
                                  '${s.store.city} · prep ${s.store.prepTimeMinutes} min · radius ${s.store.radiusKm} km',
                                  style: const TextStyle(fontSize: 11.5, color: BB.sub),
                                ),
                              ]),
                            ),
                            Wrap(spacing: 4, children: [
                              Pill(label: s.store.isOpen ? 'Open' : 'Closed', bg: s.store.isOpen ? BB.greenTint : BB.line, fg: s.store.isOpen ? BB.greenDeep : BB.sub),
                              Pill(label: s.active ? 'Active' : 'Suspended', bg: s.active ? BB.greenTint : BB.redTint, fg: s.active ? BB.greenDeep : BB.red),
                            ]),
                          ]),
                        ),
                    ]),
            ),
          ]),
        ),
      ],
    );
  }

  static String _avgMinutes(dynamic v) {
    final n = v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
    return n == n.roundToDouble() ? '${n.round()}' : n.toStringAsFixed(1);
  }

  static int _maxCount(Map<String, dynamic> byStatus) {
    var max = 1;
    for (final s in _allStatuses) {
      final n = rawInt(byStatus[s]);
      if (n > max) max = n;
    }
    return max;
  }

  Widget _cardTitle(String title, String note) => Row(children: [
        Expanded(child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.ink))),
        if (note.isNotEmpty) Text(note, style: const TextStyle(fontSize: 11.5, color: BB.faint)),
      ]);
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final Color tone;
  final Color toneFg;
  final String label;
  final String value;
  final String note;
  const _KpiCard({required this.icon, required this.tone, required this.toneFg, required this.label, required this.value, required this.note});

  @override
  Widget build(BuildContext context) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(color: tone, borderRadius: BorderRadius.circular(9)),
            child: Icon(icon, size: 17, color: toneFg),
          ),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(fontSize: 11.5, color: BB.sub, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: BB.ink)),
          const SizedBox(height: 2),
          Text(note, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: BB.faint)),
        ]),
      );
}

class _StatusRow extends StatelessWidget {
  final String status;
  final int count;
  final int maxCount;
  const _StatusRow({required this.status, required this.count, required this.maxCount});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          SizedBox(width: 118, child: Align(alignment: Alignment.centerLeft, child: StatusChip(status: status))),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: count / maxCount,
                minHeight: 6,
                backgroundColor: BB.line,
                valueColor: AlwaysStoppedAnimation(_statusBarColors[status] ?? BB.green),
              ),
            ),
          ),
          SizedBox(width: 36, child: Text('$count', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: BB.ink))),
        ]),
      );
}

class _RoleTile extends StatelessWidget {
  final IconData icon;
  final Color tone;
  final Color fg;
  final String label;
  final int count;
  const _RoleTile({required this.icon, required this.tone, required this.fg, required this.label, required this.count});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
            child: Icon(icon, size: 16, color: fg),
          ),
          const SizedBox(height: 6),
          Text('$count', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: BB.ink)),
          Text(label, style: const TextStyle(fontSize: 10.5, color: BB.sub)),
        ]),
      );
}