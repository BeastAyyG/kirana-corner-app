// Admin app shell: bottom-nav IndexedStack over Overview, Orders, Stores,
// People and More (Coupons + Audit + Settings live under More).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import 'admin_shared.dart';
import 'more_screen.dart';
import 'orders_screen.dart';
import 'overview_screen.dart';
import 'stores_screen.dart';
import 'users_screen.dart';

class AdminShell extends ConsumerStatefulWidget {
  const AdminShell({super.key});
  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> {
  int _index = 0;

  static const _tabs = [
    OverviewScreen(),
    OrdersScreen(),
    StoresScreen(),
    UsersScreen(),
    MoreScreen(),
  ];

  Future<void> _logout() async {
    final ok = await confirmAction(
      context,
      title: 'Sign out?',
      message: 'You will need to sign in again with an admin phone number.',
      confirmLabel: 'Sign out',
      danger: true,
    );
    if (!ok || !mounted) return;
    await ref.read(sessionProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kirana Corner Admin'),
        actions: [
          IconButton(
            onPressed: _logout,
            icon: const Icon(Icons.logout_rounded, color: BB.sub),
            tooltip: 'Sign out',
          ),
        ],
      ),
      body: IndexedStack(index: _index, children: _tabs),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.insights_rounded), label: 'Overview'),
          BottomNavigationBarItem(icon: Icon(Icons.receipt_long_rounded), label: 'Orders'),
          BottomNavigationBarItem(icon: Icon(Icons.storefront_rounded), label: 'Stores'),
          BottomNavigationBarItem(icon: Icon(Icons.group_rounded), label: 'People'),
          BottomNavigationBarItem(icon: Icon(Icons.more_horiz_rounded), label: 'More'),
        ],
      ),
    );
  }
}