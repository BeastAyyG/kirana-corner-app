import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'inventory_screen.dart';
import 'metrics_screen.dart';
import 'queue_screen.dart';
import 'seller_common.dart';
import 'seller_providers.dart';
import 'settings_screen.dart';

const _storePrefKey = 'kc-seller-store';

/// Seller / picker app shell: store switcher header + Queue / Inventory /
/// Metrics / Settings tabs kept alive in an IndexedStack.
class SellerShell extends ConsumerStatefulWidget {
  const SellerShell({super.key});
  @override
  ConsumerState<SellerShell> createState() => _SellerShellState();
}

class _SellerShellState extends ConsumerState<SellerShell> {
  int _index = 0;
  String? _preferredStoreId;

  @override
  void initState() {
    super.initState();
    _restorePreferredStore();
  }

  Future<void> _restorePreferredStore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _preferredStoreId = prefs.getString(_storePrefKey);
    } catch (_) {
      _preferredStoreId = null;
    }
  }

  Future<void> _selectStore(Store store) async {
    ref.read(selectedStoreProvider.notifier).state = store;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_storePrefKey, store.id);
    } catch (_) {
      // Persistence is best-effort; the in-memory selection still applies.
    }
  }

  void _openStoreSwitcher(List<Store> stores, Store current) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: BB.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(BB.radiusLg)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 18, 20, 8),
            child: Text('Switch store', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
          ),
          for (final s in stores)
            ListTile(
              leading: Icon(
                s.id == current.id ? Icons.radio_button_checked : Icons.radio_button_off,
                color: s.id == current.id ? BB.greenDark : BB.faint,
              ),
              title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: BB.ink)),
              subtitle: Text('${s.city}${s.isOpen ? '' : ' · Closed'}', style: const TextStyle(fontSize: 12, color: BB.sub)),
              onTap: () {
                Navigator.of(ctx).pop();
                _selectStore(s);
              },
            ),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final storesAsync = ref.watch(sellerStoresProvider);
    return storesAsync.when(
      loading: () => const Scaffold(body: LoadingView()),
      error: (e, _) => Scaffold(
        appBar: AppBar(title: const Text('Kirana Corner · Seller')),
        body: ErrorView(message: errorMessage(e), onRetry: () => ref.invalidate(sellerStoresProvider)),
      ),
      data: (stores) => _buildShell(stores),
    );
  }

  Widget _buildShell(List<Store> stores) {
    if (stores.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Kirana Corner · Seller')),
        body: EmptyState(
          icon: Icons.storefront_outlined,
          title: 'No store assigned',
          subtitle: 'This picker account is not staffed on any store yet. Ask an admin to add you.',
          action: OutlinedButton(
            onPressed: () => ref.read(sessionProvider.notifier).logout(),
            child: const Text('Sign out'),
          ),
        ),
      );
    }

    final selected = ref.watch(selectedStoreProvider);
    Store store;
    if (selected != null && stores.any((s) => s.id == selected.id)) {
      // Prefer the live selection (settings updates merge into it) over the
      // cached list entry so header switches reflect immediately.
      store = selected;
    } else {
      store = stores.firstWhere(
        (s) => s.id == _preferredStoreId,
        orElse: () => stores.first,
      );
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.read(selectedStoreProvider.notifier).state = store;
      });
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: InkWell(
          onTap: stores.length > 1 ? () => _openStoreSwitcher(stores, store) : null,
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(
                    child: Text(store.name, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
                  ),
                  if (stores.length > 1) const Icon(Icons.expand_more, size: 20, color: BB.sub),
                ]),
                Text(
                  '${store.city} · ${store.acceptingOrders ? 'Accepting orders' : 'Not accepting orders'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: store.acceptingOrders ? BB.greenDark : BB.red, fontWeight: FontWeight.w600),
                ),
              ]),
            ),
          ]),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh stores',
            icon: const Icon(Icons.refresh, color: BB.sub),
            onPressed: () => ref.invalidate(sellerStoresProvider),
          ),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: [
          QueueScreen(storeId: store.id),
          InventoryScreen(storeId: store.id),
          MetricsScreen(storeId: store.id),
          SettingsScreen(storeId: store.id),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.receipt_long_outlined), activeIcon: Icon(Icons.receipt_long), label: 'Queue'),
          BottomNavigationBarItem(icon: Icon(Icons.inventory_2_outlined), activeIcon: Icon(Icons.inventory_2), label: 'Inventory'),
          BottomNavigationBarItem(icon: Icon(Icons.insights_outlined), activeIcon: Icon(Icons.insights), label: 'Metrics'),
          BottomNavigationBarItem(icon: Icon(Icons.settings_outlined), activeIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}