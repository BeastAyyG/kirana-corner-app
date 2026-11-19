// Store network: searchable card list with open/accepting/active badges,
// create + edit flows and suspend/activate with confirmation. Suspended stores
// cannot be patched by the backend (404) — that error is surfaced gracefully.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';
import 'store_form_screen.dart';

/// Backend gap: PATCH /admin/stores/:id only resolves active stores, so
/// suspended stores 404. Explain that instead of a raw "not found".
String storeMutationError(Object error, AdminStore store) {
  if (error is ApiException && error.code == 'STORE_NOT_FOUND' && !store.active) {
    return 'The server blocks changes to suspended stores — reactivation needs a backend fix.';
  }
  return adminErrorMessage(error, 'Could not update the store');
}

class StoresScreen extends ConsumerStatefulWidget {
  const StoresScreen({super.key});
  @override
  ConsumerState<StoresScreen> createState() => _StoresScreenState();
}

class _StoresScreenState extends ConsumerState<StoresScreen> {
  String _search = '';
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<AdminStore> _filtered(List<AdminStore> stores) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return stores;
    return stores.where((s) {
      final store = s.store;
      return store.name.toLowerCase().contains(q) ||
          store.id.toLowerCase().contains(q) ||
          store.city.toLowerCase().contains(q) ||
          store.address.toLowerCase().contains(q);
    }).toList();
  }

  void _refresh() {
    ref.invalidate(adminStoresProvider);
    ref.invalidate(adminOverviewProvider);
  }

  Future<void> _openForm({AdminStore? store}) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => StoreFormScreen(store: store)));
  }

  Future<void> _toggleActive(AdminStore s) async {
    final suspending = s.active;
    final ok = await confirmAction(
      context,
      title: '${suspending ? 'Suspend' : 'Activate'} ${s.store.name}?',
      message: suspending
          ? 'The store stops accepting new orders immediately. Existing orders are unaffected.'
          : 'The store rejoins the network and can accept orders again.',
      confirmLabel: suspending ? 'Suspend store' : 'Activate store',
      danger: suspending,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiProvider).adminUpdateStore(s.store.id, {'active': !suspending});
      _refresh();
      if (mounted) showAdminSnack(context, suspending ? 'Store suspended' : 'Store activated');
    } catch (error) {
      if (mounted) showAdminSnack(context, storeMutationError(error, s), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final storesAsync = ref.watch(adminStoresProvider);
    return Column(children: [
      AdminHeading(
        title: 'Store network',
        subtitle: 'Service areas, prep times and rider payouts',
        actions: [
          RefreshAction(onPressed: _refresh),
          IconButton(
            onPressed: () => _openForm(),
            icon: const Icon(Icons.add_circle_rounded, color: BB.greenDark),
            tooltip: 'Add store',
          ),
        ],
      ),
      AdminSearchBox(
        controller: _searchController,
        placeholder: 'Search name, id, city or address…',
        onChanged: (v) => setState(() => _search = v),
      ),
      Expanded(
        child: storesAsync.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(message: adminErrorMessage(e, 'Could not load stores'), onRetry: _refresh),
          data: (stores) {
            final list = _filtered(stores);
            if (list.isEmpty) {
              return EmptyState(
                icon: Icons.storefront_rounded,
                title: _search.isNotEmpty ? 'No matching stores' : 'No stores yet',
                subtitle: _search.isNotEmpty
                    ? 'Try a different name, id or city.'
                    : 'Add your first store to open the network for deliveries.',
                action: _search.isNotEmpty
                    ? null
                    : PrimaryButton(label: 'Add store', icon: Icons.add_rounded, onPressed: () => _openForm()),
              );
            }
            return RefreshIndicator(
              color: BB.green,
              onRefresh: () async => ref.refresh(adminStoresProvider.future),
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                itemCount: list.length + 1,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (index == 0) {
                    return Text('${list.length} of ${stores.length} stores', style: const TextStyle(fontSize: 11.5, color: BB.faint));
                  }
                  final s = list[index - 1];
                  return _StoreCard(store: s, onTap: () => _openForm(store: s), onToggle: () => _toggleActive(s));
                },
              ),
            );
          },
        ),
      ),
    ]);
  }
}

class _StoreCard extends StatelessWidget {
  final AdminStore store;
  final VoidCallback onTap;
  final VoidCallback onToggle;
  const _StoreCard({required this.store, required this.onTap, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final s = store.store;
    return AppCard(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: BB.ink))),
          Pill(label: store.active ? 'Active' : 'Suspended', bg: store.active ? BB.greenTint : BB.redTint, fg: store.active ? BB.greenDeep : BB.red),
        ]),
        const SizedBox(height: 3),
        Text('${s.city} · ${s.pincode}', style: const TextStyle(fontSize: 12, color: BB.sub)),
        const SizedBox(height: 8),
        Wrap(spacing: 4, runSpacing: 4, children: [
          Pill(label: s.isOpen ? 'Open' : 'Closed', bg: s.isOpen ? BB.greenTint : BB.line, fg: s.isOpen ? BB.greenDeep : BB.sub),
          Pill(label: s.acceptingOrders ? 'Accepting' : 'Paused', bg: s.acceptingOrders ? BB.blueTint : BB.amberTint, fg: s.acceptingOrders ? BB.blue : BB.amber),
          if (s.surgeActive) Pill(label: 'Surge ${money(s.surgeFeeMinor)}', bg: BB.amberTint, fg: BB.amber),
        ]),
        const SizedBox(height: 8),
        Text(
          'Radius ${s.radiusKm} km · prep ${s.prepTimeMinutes} min · rider payout ${money(store.riderPayoutMinor)}',
          style: const TextStyle(fontSize: 11.5, color: BB.sub),
        ),
        const SizedBox(height: 6),
        Row(children: [
          TextButton.icon(
            onPressed: onTap,
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
            icon: const Icon(Icons.edit_rounded, size: 15),
            label: const Text('Edit', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: onToggle,
            style: TextButton.styleFrom(
              foregroundColor: store.active ? BB.red : BB.greenDark,
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
            icon: Icon(store.active ? Icons.block_rounded : Icons.check_circle_rounded, size: 15),
            label: Text(store.active ? 'Suspend' : 'Activate', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
        ]),
      ]),
    );
  }
}