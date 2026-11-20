import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import 'seller_common.dart';

/// Stores the signed-in picker is staffed on.
final sellerStoresProvider = FutureProvider<List<Store>>((ref) async {
  final data = await ref.watch(apiProvider).storeStores();
  return listFrom(data, 'stores').map(Store.fromJson).toList();
});

/// Catalogue categories for the product form.
final sellerCategoriesProvider = FutureProvider<List<Category>>((ref) async {
  final data = await ref.watch(apiProvider).categories();
  return listFrom(data, 'categories').map(Category.fromJson).toList();
});

// --- live order queue -------------------------------------------------------

class QueueState {
  final List<Order> orders;
  final bool loading;
  final String error;
  final String query;
  const QueueState({this.orders = const [], this.loading = true, this.error = '', this.query = ''});

  QueueState copyWith({List<Order>? orders, bool? loading, String? error, String? query}) => QueueState(
        orders: orders ?? this.orders,
        loading: loading ?? this.loading,
        error: error ?? this.error,
        query: query ?? this.query,
      );
}

class QueueController extends StateNotifier<QueueState> {
  QueueController(this._api, this.storeId) : super(const QueueState()) {
    refresh();
  }

  final ApiClient _api;
  final String storeId;

  /// [silent] keeps the current list on screen (periodic background refresh).
  Future<void> refresh({bool silent = false}) async {
    if (!silent) state = state.copyWith(loading: true, error: '');
    try {
      final data = await _api.storeQueue(storeId, {'q': state.query});
      if (!mounted) return;
      final orders = listFrom(data, 'orders').map(Order.fromJson).toList();
      state = state.copyWith(orders: orders, loading: false, error: '');
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(loading: false, error: silent ? state.error : errorMessage(e));
    }
  }

  void search(String query) {
    state = state.copyWith(query: query.trim());
    refresh();
  }
}

final queueProvider =
    StateNotifierProvider.family<QueueController, QueueState, String>((ref, storeId) {
  return QueueController(ref.watch(apiProvider), storeId);
});

/// Queue lanes, mirroring the web store app.
const queueGroups = <Map<String, Object>>[
  {'key': 'new', 'label': 'New', 'title': 'New orders', 'statuses': ['placed']},
  {'key': 'packing', 'label': 'Packing', 'title': 'Being picked', 'statuses': ['packing']},
  {'key': 'ready', 'label': 'Ready', 'title': 'Ready / out for delivery', 'statuses': ['packed', 'rider_assigned', 'picked_up']},
  {'key': 'done', 'label': 'Done', 'title': 'Completed', 'statuses': ['delivered', 'cancelled']},
];

List<Order> ordersInGroup(List<Order> orders, Map<String, Object> group) {
  final statuses = (group['statuses'] as List).cast<String>();
  return orders.where((o) => statuses.contains(o.status)).toList();
}