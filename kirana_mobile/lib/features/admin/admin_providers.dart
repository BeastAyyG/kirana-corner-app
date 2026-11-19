// Riverpod data sources for the admin module. Each screen watches one of these
// and invalidates after mutations so every tab stays truthful.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import 'admin_models.dart';

final adminOverviewProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final data = await ref.watch(apiProvider).adminOverview();
  return mapFrom(data, 'overview');
});

final adminStoresProvider = FutureProvider<List<AdminStore>>((ref) async {
  final data = await ref.watch(apiProvider).adminStores();
  return listFrom(data, 'stores').map(AdminStore.fromJson).toList();
});

final adminUsersProvider = FutureProvider<List<AdminUserRow>>((ref) async {
  final data = await ref.watch(apiProvider).adminUsers();
  return listFrom(data, 'users').map(AdminUserRow.fromJson).toList();
});

final adminCouponsProvider = FutureProvider<List<AdminCoupon>>((ref) async {
  final data = await ref.watch(apiProvider).adminCoupons();
  return listFrom(data, 'coupons').map(AdminCoupon.fromJson).toList();
});

/// Keyed by status filter ('' = all). The backend caps the list at 200, newest first.
final adminOrdersProvider = FutureProvider.family<List<Order>, String>((ref, status) async {
  final data = await ref.watch(apiProvider).adminOrders({'status': status});
  return listFrom(data, 'orders').map(Order.fromJson).toList();
});

/// The audit envelope key is `events` (confirmed against the web state.js).
final adminAuditProvider = FutureProvider.family<List<Map<String, dynamic>>, int>((ref, limit) async {
  final data = await ref.watch(apiProvider).adminAudit(limit);
  return listFrom(data, 'events');
});