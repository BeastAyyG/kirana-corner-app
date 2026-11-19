import 'package:dio/dio.dart';
import '../config.dart';
import 'api_exception.dart';

/// Extract a list of maps from an envelope like {"products":[...]} or a bare list.
List<Map<String, dynamic>> listFrom(dynamic data, String key) {
  dynamic raw;
  if (data is Map) {
    raw = data[key];
  } else if (data is List) {
    raw = data;
  }
  if (raw is! List) return const [];
  return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
}

Map<String, dynamic> mapFrom(dynamic data, [String? key]) {
  dynamic raw = data;
  if (key != null && data is Map) raw = data[key];
  if (raw is Map) return Map<String, dynamic>.from(raw);
  return <String, dynamic>{};
}

/// Dio-based client for the Kirana delivery v2 API. Bearer-token OTP sessions,
/// JSON envelope. Method names mirror the web _shared/api.js contract.
class ApiClient {
  final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 25),
    responseType: ResponseType.json,
  ));

  String token = '';

  Future<dynamic> _req(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    String? idempotencyKey,
  }) async {
    _dio.options.baseUrl = AppConfig.apiBase;
    final headers = <String, String>{};
    if (token.isNotEmpty) headers['authorization'] = 'Bearer $token';
    if (body != null) headers['content-type'] = 'application/json';
    if (idempotencyKey != null) headers['idempotency-key'] = idempotencyKey;
    Map<String, dynamic>? cleanQuery;
    if (query != null) {
      cleanQuery = Map.fromEntries(query.entries
          .where((e) => e.value != null && e.value != '' && e.value != false));
    }
    try {
      final res = await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: cleanQuery,
        options: Options(method: method, headers: headers),
      );
      return res.data;
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map) {
        throw ApiException(
          e.response?.statusCode ?? 0,
          (data['code'] ?? 'ERROR').toString(),
          (data['message'] ?? 'Request failed').toString(),
          data['details'],
        );
      }
      throw ApiException(0, 'NETWORK', 'You appear to be offline. Check your connection.');
    }
  }

  // auth
  Future<dynamic> requestOtp(String phone) => _req('POST', '/auth/otp/request', body: {'phone': phone});
  Future<dynamic> verifyOtp(String phone, String code, [String name = '']) =>
      _req('POST', '/auth/otp/verify', body: {'phone': phone, 'code': code, 'name': name});
  Future<dynamic> me() => _req('GET', '/auth/me');
  Future<dynamic> updateProfile(String name) => _req('PATCH', '/auth/me', body: {'name': name});
  Future<dynamic> logout() => _req('POST', '/auth/logout');

  // catalog (public)
  Future<dynamic> categories() => _req('GET', '/categories');
  Future<dynamic> stores() => _req('GET', '/stores');
  Future<dynamic> serviceability(double lat, double lng) =>
      _req('POST', '/serviceability', body: {'lat': lat, 'lng': lng});
  Future<dynamic> products(String storeId, [Map<String, dynamic>? params]) =>
      _req('GET', '/stores/$storeId/products', query: params);
  Future<dynamic> product(String storeId, String pid) => _req('GET', '/stores/$storeId/products/$pid');
  Future<dynamic> search(String storeId, String q) => _req('GET', '/stores/$storeId/search', query: {'q': q});
  Future<dynamic> slots(String storeId, String date) =>
      _req('GET', '/stores/$storeId/delivery-slots', query: {'date': date});

  // customer
  Future<dynamic> addresses() => _req('GET', '/addresses');
  Future<dynamic> createAddress(Map<String, dynamic> a) => _req('POST', '/addresses', body: a);
  Future<dynamic> updateAddress(String id, Map<String, dynamic> a) => _req('PATCH', '/addresses/$id', body: a);
  Future<dynamic> deleteAddress(String id) => _req('DELETE', '/addresses/$id');
  Future<dynamic> cart() => _req('GET', '/cart');
  Future<dynamic> putCart(String storeId, List items) => _req('PUT', '/cart', body: {'store_id': storeId, 'items': items});
  Future<dynamic> clearCart() => _req('DELETE', '/cart');
  Future<dynamic> addItem(String storeId, String pid, [int quantity = 1]) =>
      _req('POST', '/cart/items', body: {'store_id': storeId, 'product_id': pid, 'quantity': quantity});
  Future<dynamic> setItemQty(String pid, int quantity) => _req('PATCH', '/cart/items/$pid', body: {'quantity': quantity});
  Future<dynamic> quote(Map<String, dynamic> body) => _req('POST', '/cart/quote', body: body);
  Future<dynamic> coupons() => _req('GET', '/coupons');
  Future<dynamic> saved() => _req('GET', '/saved');
  Future<dynamic> save(String storeId, String pid) => _req('PUT', '/saved/$storeId/$pid');
  Future<dynamic> unsave(String storeId, String pid) => _req('DELETE', '/saved/$storeId/$pid');
  Future<dynamic> createOrder(Map<String, dynamic> body, String key) =>
      _req('POST', '/orders', body: body, idempotencyKey: key);
  Future<dynamic> orders([String status = '']) => _req('GET', '/orders', query: {'status': status});
  Future<dynamic> order(String id) => _req('GET', '/orders/$id');
  Future<dynamic> cancelOrder(String id, [String reason = '']) => _req('POST', '/orders/$id/cancel', body: {'reason': reason});
  Future<dynamic> reorder(String id) => _req('POST', '/orders/$id/reorder');
  Future<dynamic> rateOrder(String id, int rating, [String comment = '']) =>
      _req('POST', '/orders/$id/rate', body: {'rating': rating, 'comment': comment});
  Future<dynamic> payOrder(String id) => _req('POST', '/orders/$id/pay');
  Future<dynamic> confirmPayment(String pid) => _req('POST', '/payments/$pid/confirm');
  Future<dynamic> notifications() => _req('GET', '/notifications');
  Future<dynamic> readNotification(String id) => _req('POST', '/notifications/$id/read');
  Future<dynamic> readAllNotifications() => _req('POST', '/notifications/read-all');
  Future<dynamic> simulate(String id) => _req('POST', '/dev/orders/$id/simulate');

  // store / picker
  Future<dynamic> storeStores() => _req('GET', '/store/stores');
  Future<dynamic> storeQueue(String storeId, [Map<String, dynamic>? params]) =>
      _req('GET', '/store/$storeId/queue', query: params);
  Future<dynamic> storeOrder(String storeId, String oid) => _req('GET', '/store/$storeId/orders/$oid');
  Future<dynamic> startPacking(String oid) => _req('POST', '/store/orders/$oid/start-packing');
  Future<dynamic> pickItem(String oid, String itemId, int pickedQuantity) =>
      _req('POST', '/store/orders/$oid/items/$itemId/pick', body: {'picked_quantity': pickedQuantity});
  Future<dynamic> packOrder(String oid) => _req('POST', '/store/orders/$oid/pack');
  Future<dynamic> inventory(String storeId, [Map<String, dynamic>? params]) =>
      _req('GET', '/store/$storeId/inventory', query: params);
  Future<dynamic> adjustInventory(String storeId, String pid, Map<String, dynamic> body) =>
      _req('POST', '/store/$storeId/inventory/$pid/adjust', body: body);
  Future<dynamic> createStoreProduct(String storeId, Map<String, dynamic> body) =>
      _req('POST', '/store/$storeId/products', body: body);
  Future<dynamic> updateStoreProduct(String storeId, String pid, Map<String, dynamic> body) =>
      _req('PATCH', '/store/$storeId/products/$pid', body: body);
  Future<dynamic> storeSettings(String storeId) => _req('GET', '/store/$storeId/settings');
  Future<dynamic> updateStoreSettings(String storeId, Map<String, dynamic> body) =>
      _req('PUT', '/store/$storeId/settings', body: body);
  Future<dynamic> storeMetrics(String storeId) => _req('GET', '/store/$storeId/metrics');

  // rider
  Future<dynamic> riderMe() => _req('GET', '/rider/me');
  Future<dynamic> riderAvailability(bool online) => _req('POST', '/rider/availability', body: {'online': online});
  Future<dynamic> riderLocation(double lat, double lng) => _req('POST', '/rider/location', body: {'lat': lat, 'lng': lng});
  Future<dynamic> riderJobs([String status = '']) => _req('GET', '/rider/jobs', query: {'status': status});
  Future<dynamic> acceptJob(String id) => _req('POST', '/rider/jobs/$id/accept');
  Future<dynamic> declineJob(String id) => _req('POST', '/rider/jobs/$id/decline');
  Future<dynamic> pickupJob(String id, [String pickupCode = '']) =>
      _req('POST', '/rider/jobs/$id/pickup', body: {'pickup_code': pickupCode});
  Future<dynamic> deliverJob(String id, [Map<String, dynamic>? body]) =>
      _req('POST', '/rider/jobs/$id/deliver', body: body ?? {});
  Future<dynamic> riderEarnings() => _req('GET', '/rider/earnings');

  // admin
  Future<dynamic> adminOverview() => _req('GET', '/admin/overview');
  Future<dynamic> adminStores() => _req('GET', '/admin/stores');
  Future<dynamic> adminCreateStore(Map<String, dynamic> body) => _req('POST', '/admin/stores', body: body);
  Future<dynamic> adminUpdateStore(String id, Map<String, dynamic> body) => _req('PATCH', '/admin/stores/$id', body: body);
  Future<dynamic> adminUsers([String role = '']) => _req('GET', '/admin/users', query: {'role': role});
  Future<dynamic> adminCreateUser(Map<String, dynamic> body) => _req('POST', '/admin/users', body: body);
  Future<dynamic> adminSetUserActive(String id, bool active) => _req('PATCH', '/admin/users/$id', body: {'active': active});
  Future<dynamic> adminCoupons() => _req('GET', '/admin/coupons');
  Future<dynamic> adminCreateCoupon(Map<String, dynamic> body) => _req('POST', '/admin/coupons', body: body);
  Future<dynamic> adminUpdateCoupon(String id, Map<String, dynamic> body) => _req('PATCH', '/admin/coupons/$id', body: body);
  Future<dynamic> adminOrders([Map<String, dynamic>? params]) => _req('GET', '/admin/orders', query: params);
  Future<dynamic> adminCancelOrder(String id, [String reason = '']) => _req('POST', '/admin/orders/$id/cancel', body: {'reason': reason});
  Future<dynamic> adminAudit([int limit = 100]) => _req('GET', '/admin/audit', query: {'limit': limit});
}