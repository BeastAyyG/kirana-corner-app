// Admin-specific row models. The admin endpoints return extra keys the shared
// models do not carry (store.active / rider_payout_minor, user.created_at,
// coupon.value / usage counters), so lists are parsed defensively from raw maps.
import '../../core/format.dart';
import '../../core/models.dart';

int _i(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
bool _b(dynamic v) => v == true || v == 1 || v == '1' || v == 'true';
String _s(dynamic v) => v == null ? '' : '$v';

class AdminStore {
  final Store store;
  final bool active;
  final int riderPayoutMinor;
  const AdminStore({required this.store, this.active = true, this.riderPayoutMinor = 0});

  factory AdminStore.fromJson(Map<String, dynamic> j) => AdminStore(
        store: Store.fromJson(j),
        active: j.containsKey('active') ? _b(j['active']) : true,
        riderPayoutMinor: _i(j['rider_payout_minor']),
      );
}

class AdminUserRow {
  final AppUser user;
  final String createdAt;
  const AdminUserRow({required this.user, this.createdAt = ''});

  factory AdminUserRow.fromJson(Map<String, dynamic> j) => AdminUserRow(
        user: AppUser.fromJson(j),
        createdAt: _s(j['created_at']),
      );
}

class AdminCoupon {
  final String id, code, description, type, startsAt, endsAt;
  final int value, minOrderMinor, maxDiscountMinor, usedCount, usageLimit, perUserLimit;
  final bool active;
  const AdminCoupon({
    required this.id,
    required this.code,
    this.description = '',
    this.type = 'flat',
    this.startsAt = '',
    this.endsAt = '',
    this.value = 0,
    this.minOrderMinor = 0,
    this.maxDiscountMinor = 0,
    this.usedCount = 0,
    this.usageLimit = 0,
    this.perUserLimit = 0,
    this.active = true,
  });

  factory AdminCoupon.fromJson(Map<String, dynamic> j) => AdminCoupon(
        id: _s(j['id']),
        code: _s(j['code']),
        description: _s(j['description']),
        type: _s(j['type']),
        startsAt: _s(j['starts_at']),
        endsAt: _s(j['ends_at']),
        // Admin list uses `value` (paise for flat, whole percent for percent).
        value: _i(j['value'] ?? j['value_minor']),
        minOrderMinor: _i(j['min_order_minor']),
        maxDiscountMinor: _i(j['max_discount_minor']),
        usedCount: _i(j['used_count']),
        usageLimit: _i(j['usage_limit']),
        perUserLimit: _i(j['per_user_limit']),
        active: j.containsKey('active') ? _b(j['active']) : true,
      );

  String get typeLabel => switch (type) {
        'flat' => 'Flat off',
        'percent' => 'Percent off',
        'free_delivery' => 'Free delivery',
        _ => type,
      };

  String get valueLabel => switch (type) {
        'flat' => money(value),
        'percent' => '$value%',
        _ => 'Free delivery',
      };

  /// Live / Paused / Expired / Scheduled, mirroring the web state pill.
  String get stateLabel {
    if (!active) return 'Paused';
    final now = DateTime.now();
    final ends = DateTime.tryParse(endsAt);
    final starts = DateTime.tryParse(startsAt);
    if (ends != null && ends.isBefore(now)) return 'Expired';
    if (starts != null && starts.isAfter(now)) return 'Scheduled';
    return 'Live';
  }
}

/// The v2 bill uses grand_total_minor; the shared OrderBill reads total_minor.
int orderTotalMinor(Order order) {
  final bill = order.raw['bill'];
  if (bill is Map) return _i(bill['grand_total_minor'] ?? bill['total_minor']);
  return order.bill.totalMinor;
}

Map<String, dynamic> rawMap(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Map<String, dynamic>> rawList(dynamic v) =>
    v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

int rawInt(dynamic v) => _i(v);
String rawString(dynamic v) => _s(v);