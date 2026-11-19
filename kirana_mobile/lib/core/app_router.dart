import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/auth/auth_screen.dart';
import '../features/customer/customer_shell.dart';
import '../features/seller/seller_shell.dart';
import '../features/rider/rider_shell.dart';
import '../features/admin/admin_shell.dart';
import 'providers.dart';
import 'theme.dart';

String roleHome(String role) {
  switch (role) {
    case 'admin': return '/admin';
    case 'rider': return '/rider';
    case 'picker': return '/seller';
    default: return '/customer';
  }
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: BB.green,
        body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.storefront_rounded, color: Colors.white, size: 64),
          SizedBox(height: 16),
          Text('Kirana Corner', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
          SizedBox(height: 24),
          SizedBox(width: 26, height: 26, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5)),
        ])),
      );
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<SessionState>(ref.read(sessionProvider));
  ref.listen<SessionState>(sessionProvider, (_, next) => refresh.value = next);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (session.status == SessionStatus.unknown) {
        return loc == '/splash' ? null : '/splash';
      }
      if (session.status == SessionStatus.unauthenticated) {
        return loc == '/auth' ? null : '/auth';
      }
      final home = roleHome(session.role);
      if (loc == '/auth' || loc == '/splash' || loc == '/') return home;
      if (!loc.startsWith(home)) return home;
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const _Splash()),
      GoRoute(path: '/auth', builder: (_, __) => const AuthScreen()),
      GoRoute(path: '/customer', builder: (_, __) => const CustomerShell()),
      GoRoute(path: '/seller', builder: (_, __) => const SellerShell()),
      GoRoute(path: '/rider', builder: (_, __) => const RiderShell()),
      GoRoute(path: '/admin', builder: (_, __) => const AdminShell()),
    ],
  );
});