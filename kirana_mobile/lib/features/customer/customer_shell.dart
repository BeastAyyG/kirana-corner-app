import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'account_screen.dart';
import 'browse_screen.dart';
import 'cart_screen.dart';
import 'customer_providers.dart';
import 'home_screen.dart';
import 'orders_screen.dart';

/// Customer app shell: resolves the serviceable store on first load, owns the
/// 5-tab bottom navigation (Home / Browse / Cart / Orders / Account) and keeps
/// the active-order banner fresh with a light polling loop.
class CustomerShell extends ConsumerStatefulWidget {
  const CustomerShell({super.key});

  @override
  ConsumerState<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends ConsumerState<CustomerShell> {
  Timer? _orderPoll;

  @override
  void initState() {
    super.initState();
    _bootstrap();
    _orderPoll = Timer.periodic(const Duration(seconds: 15), (_) => _pollActiveOrder());
  }

  Future<void> _bootstrap() async {
    try {
      await ref.read(cartProvider.notifier).refresh();
    } catch (_) {
      // Basket stays null; the cart tab retries on entry.
    }
    try {
      await ref.read(savedProvider.notifier).refresh();
    } catch (_) {}
    try {
      await ref.read(addressesProvider.notifier).load();
    } catch (_) {}
    ref.invalidate(ordersProvider);
    _pollActiveOrder();
  }

  Future<void> _pollActiveOrder() async {
    if (!mounted) return;
    try {
      final res = await ref.read(apiProvider).orders();
      if (!mounted) return;
      final orders = listFrom(res, 'orders').map(Order.fromJson).toList();
      Order? live;
      for (final o in orders) {
        if (isLive(o.status)) { live = o; break; }
      }
      ref.read(activeOrderProvider.notifier).state = live;
      if (ref.read(customerTabProvider) == 3) ref.invalidate(ordersProvider);
    } catch (_) {
      // Polling is best-effort; screens surface their own errors.
    }
  }

  @override
  void dispose() {
    _orderPoll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final init = ref.watch(storeInitProvider);
    return init.when(
      loading: () => const Scaffold(
        backgroundColor: BB.headerTint,
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(color: BB.green),
            SizedBox(height: 16),
            Text('Finding your nearest kirana…', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: BB.greenDeep)),
          ]),
        ),
      ),
      error: (e, _) => Scaffold(
        body: ErrorView(message: '$e', onRetry: () => ref.invalidate(storeInitProvider)),
      ),
      data: (store) => store == null
          ? Scaffold(
              body: EmptyState(
                icon: Icons.storefront_outlined,
                title: 'No stores available',
                subtitle: 'We could not find a Kirana Corner store yet. Check the server URL in Account or try again.',
                action: PrimaryButton(label: 'Retry', onPressed: () => ref.invalidate(storeInitProvider)),
              ),
            )
          : _shell(),
    );
  }

  Widget _shell() {
    final tab = ref.watch(customerTabProvider);
    final cart = ref.watch(cartProvider);
    final count = cart?.count ?? 0;
    return Scaffold(
      body: IndexedStack(
        index: tab,
        children: const [
          HomeScreen(),
          BrowseScreen(),
          CartScreen(),
          OrdersScreen(),
          AccountScreen(),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: tab,
        onTap: (i) => ref.read(customerTabProvider.notifier).state = i,
        type: BottomNavigationBarType.fixed,
        backgroundColor: BB.card,
        selectedItemColor: BB.greenDark,
        unselectedItemColor: BB.sub,
        selectedFontSize: 11,
        unselectedFontSize: 11,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w800),
        unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600),
        elevation: 12,
        items: [
          const BottomNavigationBarItem(icon: Icon(Icons.home_outlined), activeIcon: Icon(Icons.home_rounded), label: 'Home'),
          const BottomNavigationBarItem(icon: Icon(Icons.grid_view_outlined), activeIcon: Icon(Icons.grid_view_rounded), label: 'Browse'),
          BottomNavigationBarItem(
            icon: Badge.count(count: count, isLabelVisible: count > 0, child: const Icon(Icons.shopping_basket_outlined)),
            activeIcon: Badge.count(count: count, isLabelVisible: count > 0, child: const Icon(Icons.shopping_basket_rounded)),
            label: 'Cart',
          ),
          const BottomNavigationBarItem(icon: Icon(Icons.receipt_long_outlined), activeIcon: Icon(Icons.receipt_long_rounded), label: 'Orders'),
          const BottomNavigationBarItem(icon: Icon(Icons.person_outline_rounded), activeIcon: Icon(Icons.person_rounded), label: 'Account'),
        ],
      ),
    );
  }
}