import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import 'customer_data.dart';

/// Riverpod state for the customer module. Everything talks to the real v2 API
/// through [apiProvider]; screens watch these providers and refresh them.

/// Active bottom-nav tab (0 Home, 1 Browse, 2 Cart, 3 Orders, 4 Account).
final customerTabProvider = StateProvider<int>((ref) => 0);

/// Category filter applied to the Browse tab (set from Home category taps).
final browseCategoryProvider = StateProvider<String>((ref) => '');

/// Incremented to request search focus in Browse (header search pill).
final browseSearchFocusProvider = StateProvider<int>((ref) => 0);

final selectedAddressProvider = StateProvider<Address?>((ref) => null);
final serviceInfoProvider = StateProvider<ServiceInfo?>((ref) => null);
final activeOrderProvider = StateProvider<Order?>((ref) => null);
final checkoutDraftProvider = StateProvider<CheckoutDraft>((ref) => const CheckoutDraft());

/// One-time store resolution: default address → serviceability, else first
/// store from GET /stores. Primes the selected address + service info.
final storeInitProvider = FutureProvider<Store?>((ref) async {
  final existing = ref.read(selectedStoreProvider);
  if (existing != null) return existing;
  final api = ref.read(apiProvider);

  List<Address> addresses = const [];
  try {
    addresses = await ref.read(addressesProvider.notifier).load();
  } catch (_) {
    // Addresses are optional for browsing; fall back to the store list.
  }
  Address? addr;
  for (final a in addresses) {
    if (a.isDefault) { addr = a; break; }
  }
  addr ??= addresses.isNotEmpty ? addresses.first : null;
  if (addr != null) {
    ref.read(selectedAddressProvider.notifier).state = addr;
    if (addr.lat != 0 || addr.lng != 0) {
      try {
        final res = await api.serviceability(addr.lat, addr.lng);
        final info = ServiceInfo.fromJson(mapFrom(res));
        ref.read(serviceInfoProvider.notifier).state = info;
        if (info.serviceable && res is Map && res['store'] is Map) {
          final store = Store.fromJson(mapFrom(res, 'store'));
          ref.read(selectedStoreProvider.notifier).state = store;
          return store;
        }
      } catch (_) {
        // Fall through to the public store list.
      }
    }
  }
  final stores = listFrom(await api.stores(), 'stores').map(Store.fromJson).toList();
  if (stores.isEmpty) return null;
  final store = stores.first;
  ref.read(selectedStoreProvider.notifier).state = store;
  return store;
});

/// Select a delivery address and re-resolve the serviceable store + ETA.
Future<ServiceInfo?> applyAddress(WidgetRef ref, Address addr) async {
  ref.read(selectedAddressProvider.notifier).state = addr;
  if (addr.lat == 0 && addr.lng == 0) return null;
  final res = await ref.read(apiProvider).serviceability(addr.lat, addr.lng);
  final info = ServiceInfo.fromJson(mapFrom(res));
  ref.read(serviceInfoProvider.notifier).state = info;
  if (info.serviceable && res is Map && res['store'] is Map) {
    ref.read(selectedStoreProvider.notifier).state = Store.fromJson(mapFrom(res, 'store'));
  }
  return info;
}

final categoriesProvider = FutureProvider<List<Category>>((ref) async {
  final res = await ref.watch(apiProvider).categories();
  final list = listFrom(res, 'categories').map(Category.fromJson).toList();
  list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  return list;
});

final couponsProvider = FutureProvider<List<Coupon>>((ref) async {
  final res = await ref.watch(apiProvider).coupons();
  return listFrom(res, 'coupons').map(Coupon.fromJson).toList();
});

final homeProductsProvider = FutureProvider<List<Product>>((ref) async {
  final store = ref.watch(selectedStoreProvider);
  if (store == null) return const [];
  final res = await ref.watch(apiProvider).products(store.id, {'page_size': 40, 'in_stock': 'true'});
  return listFrom(res, 'products').map(parseProduct).toList();
});

final ordersProvider = FutureProvider<List<Order>>((ref) async {
  final res = await ref.watch(apiProvider).orders();
  return listFrom(res, 'orders').map(Order.fromJson).toList();
});

final notificationsProvider = FutureProvider<List<NotificationItem>>((ref) async {
  final res = await ref.watch(apiProvider).notifications();
  return listFrom(res, 'notifications').map(NotificationItem.fromJson).toList();
});

/// Server cart. `null` until the first successful load. Mutations throw
/// [ApiException] so the calling screen can surface the backend message.
class CartNotifier extends StateNotifier<Cart?> {
  final ApiClient _api;
  CartNotifier(this._api) : super(null);

  /// Product ids whose price changed since they were added to the basket.
  final Set<String> priceChangedIds = <String>{};

  Future<void> refresh() async => _adopt(await _api.cart());

  void adopt(Cart cart) {
    priceChangedIds.clear();
    state = cart;
  }

  void _adopt(dynamic res) {
    final m = mapFrom(res, 'cart');
    priceChangedIds.clear();
    state = parseCart(m, priceChangedIds: priceChangedIds);
  }

  Future<void> setQty(String storeId, String productId, int quantity) async {
    final current = cartQtyOf(state, productId);
    final res = (current == 0 && quantity > 0)
        ? await _api.addItem(storeId, productId, quantity)
        : await _api.setItemQty(productId, quantity);
    _adopt(res);
  }

  Future<void> clear() async => _adopt(await _api.clearCart());
}

final cartProvider = StateNotifierProvider<CartNotifier, Cart?>((ref) {
  return CartNotifier(ref.watch(apiProvider));
});

/// Saved-for-later products. `null` until first load.
class SavedNotifier extends StateNotifier<List<Product>?> {
  final ApiClient _api;
  SavedNotifier(this._api) : super(null);

  bool isSaved(String productId) => state?.any((p) => p.id == productId) ?? false;

  Future<void> refresh() async {
    final res = await _api.saved();
    state = listFrom(res, 'products').map(parseProduct).toList();
  }

  /// Returns true when the product is saved after the toggle.
  Future<bool> toggle(String storeId, String productId) async {
    final wasSaved = isSaved(productId);
    final res = wasSaved ? await _api.unsave(storeId, productId) : await _api.save(storeId, productId);
    state = listFrom(res, 'products').map(parseProduct).toList();
    return !wasSaved;
  }
}

final savedProvider = StateNotifierProvider<SavedNotifier, List<Product>?>((ref) {
  return SavedNotifier(ref.watch(apiProvider));
});

/// Delivery addresses with full CRUD; AsyncValue drives loading/error states.
class AddressesNotifier extends StateNotifier<AsyncValue<List<Address>>> {
  final ApiClient _api;
  AddressesNotifier(this._api) : super(const AsyncValue.loading());

  Future<List<Address>> load() async {
    try {
      final res = await _api.addresses();
      final list = listFrom(res, 'addresses').map(Address.fromJson).toList();
      state = AsyncValue.data(list);
      return list;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      rethrow;
    }
  }

  Future<Address> create(Map<String, dynamic> body) async {
    final res = await _api.createAddress(body);
    final addr = Address.fromJson(mapFrom(res, 'address'));
    state = AsyncValue.data([...(state.value ?? const <Address>[]), addr]);
    return addr;
  }

  Future<Address> update(String id, Map<String, dynamic> body) async {
    final res = await _api.updateAddress(id, body);
    final addr = Address.fromJson(mapFrom(res, 'address'));
    final current = state.value ?? const <Address>[];
    state = AsyncValue.data([for (final a in current) a.id == id ? addr : a]);
    return addr;
  }

  Future<void> remove(String id) async {
    await _api.deleteAddress(id);
    final current = state.value ?? const <Address>[];
    state = AsyncValue.data(current.where((a) => a.id != id).toList());
  }
}

final addressesProvider = StateNotifierProvider<AddressesNotifier, AsyncValue<List<Address>>>((ref) {
  return AddressesNotifier(ref.watch(apiProvider));
});

/// Invalidate customer data after the server URL changes.
void resetCustomerData(WidgetRef ref) {
  ref.read(selectedStoreProvider.notifier).state = null;
  ref.read(selectedAddressProvider.notifier).state = null;
  ref.read(serviceInfoProvider.notifier).state = null;
  ref.read(activeOrderProvider.notifier).state = null;
  ref.read(checkoutDraftProvider.notifier).state = const CheckoutDraft();
  ref.read(cartProvider.notifier).adopt(Cart());
  ref.invalidate(storeInitProvider);
  ref.invalidate(categoriesProvider);
  ref.invalidate(couponsProvider);
  ref.invalidate(homeProductsProvider);
  ref.invalidate(ordersProvider);
  ref.invalidate(notificationsProvider);
  ref.invalidate(addressesProvider);
  ref.invalidate(savedProvider);
}