import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/models.dart';
import '../../core/providers.dart';

/// Selected bottom-nav tab of the rider shell (0 Duty, 1 Jobs, 2 Earnings, 3 Account).
final riderTabProvider = StateProvider<int>((ref) => 0);

/// Hint shown when GPS permission/service is unavailable while on duty.
final riderLocationHintProvider = StateProvider<String?>((ref) => null);

int _i(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);

/// One earnings window: {deliveries, payout_minor, tips_minor, total_minor, cash_collected_minor}.
class EarningsPeriod {
  final int deliveries, payoutMinor, tipsMinor, totalMinor, cashCollectedMinor;
  const EarningsPeriod({
    this.deliveries = 0,
    this.payoutMinor = 0,
    this.tipsMinor = 0,
    this.totalMinor = 0,
    this.cashCollectedMinor = 0,
  });
  factory EarningsPeriod.fromJson(Map<String, dynamic> j) => EarningsPeriod(
        deliveries: _i(j['deliveries']),
        payoutMinor: _i(j['payout_minor']),
        tipsMinor: _i(j['tips_minor']),
        totalMinor: _i(j['total_minor']),
        cashCollectedMinor: _i(j['cash_collected_minor']),
      );
}

/// GET /rider/earnings → {earnings:{today, week, all_time}}.
class RiderEarnings {
  final EarningsPeriod today, week, allTime;
  const RiderEarnings({
    this.today = const EarningsPeriod(),
    this.week = const EarningsPeriod(),
    this.allTime = const EarningsPeriod(),
  });
  factory RiderEarnings.fromJson(Map<String, dynamic> j) => RiderEarnings(
        today: EarningsPeriod.fromJson(mapFrom(j['today'])),
        week: EarningsPeriod.fromJson(mapFrom(j['week'])),
        allTime: EarningsPeriod.fromJson(mapFrom(j['all_time'])),
      );
}

/// Rider profile + duty availability (GET /rider/me, POST /rider/availability).
class RiderProfileNotifier extends AsyncNotifier<Rider> {
  @override
  Future<Rider> build() => _fetch();

  Future<Rider> _fetch() async {
    final data = await ref.read(apiProvider).riderMe();
    return Rider.fromJson(mapFrom(data, 'rider'));
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_fetch);
  }

  /// Flip availability, then pull jobs (going online can instantly offer one).
  Future<bool> setOnline(bool online) async {
    final data = await ref.read(apiProvider).riderAvailability(online);
    final rider = Rider.fromJson(mapFrom(data, 'rider'));
    state = AsyncData(rider);
    await ref.read(riderJobsProvider.notifier).refresh(silent: true);
    return rider.isOnline;
  }
}

final riderProfileProvider =
    AsyncNotifierProvider<RiderProfileNotifier, Rider>(RiderProfileNotifier.new);

/// All rider jobs: offered first, then active, then history (GET /rider/jobs).
class RiderJobsNotifier extends AsyncNotifier<List<Job>> {
  @override
  Future<List<Job>> build() => _fetch();

  Future<List<Job>> _fetch() async {
    final data = await ref.read(apiProvider).riderJobs();
    return listFrom(data, 'jobs').map(Job.fromJson).toList();
  }

  /// Silent refresh keeps the previous data on screen (poll-friendly).
  Future<void> refresh({bool silent = false}) async {
    if (!silent) state = const AsyncLoading<List<Job>>().copyWithPrevious(state);
    state = await AsyncValue.guard(_fetch);
  }

  Future<void> accept(String id) async {
    await ref.read(apiProvider).acceptJob(id);
    await refresh(silent: true);
  }

  Future<void> decline(String id) async {
    await ref.read(apiProvider).declineJob(id);
    await refresh(silent: true);
  }

  /// Confirm pickup with the store code; returns the refreshed job.
  Future<Job> pickup(String id, String pickupCode) async {
    final data = await ref.read(apiProvider).pickupJob(id, pickupCode);
    final job = Job.fromJson(mapFrom(data, 'job'));
    await refresh(silent: true);
    return job;
  }

  /// Complete delivery: {delivery_otp, cash_collected} (web job.js contract).
  Future<Job> deliver(String id, {required String deliveryOtp, required bool cashCollected}) async {
    final data = await ref.read(apiProvider).deliverJob(id, {
      'delivery_otp': deliveryOtp,
      'cash_collected': cashCollected,
    });
    final job = Job.fromJson(mapFrom(data, 'job'));
    await refresh(silent: true);
    return job;
  }
}

final riderJobsProvider =
    AsyncNotifierProvider<RiderJobsNotifier, List<Job>>(RiderJobsNotifier.new);

class RiderEarningsNotifier extends AsyncNotifier<RiderEarnings> {
  @override
  Future<RiderEarnings> build() => _fetch();

  Future<RiderEarnings> _fetch() async {
    final data = await ref.read(apiProvider).riderEarnings();
    return RiderEarnings.fromJson(mapFrom(data, 'earnings'));
  }

  Future<void> refresh({bool silent = false}) async {
    if (!silent) state = const AsyncLoading<RiderEarnings>().copyWithPrevious(state);
    state = await AsyncValue.guard(_fetch);
  }
}

final riderEarningsProvider =
    AsyncNotifierProvider<RiderEarningsNotifier, RiderEarnings>(RiderEarningsNotifier.new);

/// Home store of the signed-in rider (public /stores lookup). Decorative +
/// used as the location fallback when GPS is unavailable.
final riderHomeStoreProvider = FutureProvider<Store?>((ref) async {
  final rider = await ref.watch(riderProfileProvider.future);
  try {
    final data = await ref.read(apiProvider).stores();
    final stores = listFrom(data, 'stores').map(Store.fromJson).toList();
    for (final s in stores) {
      if (s.id == rider.homeStoreId) return s;
    }
    return stores.isNotEmpty ? stores.first : null;
  } catch (_) {
    return null; // store name is decorative — profile still renders
  }
});

/// Derived job buckets (mirrors web state.js offeredJobs/activeJobs/pastJobs).
final riderOffersProvider = Provider<List<Job>>((ref) {
  final jobs = ref.watch(riderJobsProvider).valueOrNull ?? const <Job>[];
  return jobs.where((j) => j.status == 'offered').toList();
});

final riderActiveJobsProvider = Provider<List<Job>>((ref) {
  final jobs = ref.watch(riderJobsProvider).valueOrNull ?? const <Job>[];
  return jobs.where((j) => j.status == 'accepted' || j.status == 'picked_up').toList();
});

final riderPastJobsProvider = Provider<List<Job>>((ref) {
  final jobs = ref.watch(riderJobsProvider).valueOrNull ?? const <Job>[];
  final past = jobs.where((j) => j.status == 'delivered').toList();
  past.sort((a, b) {
    final ad = DateTime.tryParse('${a.raw['delivered_at']}') ?? DateTime(0);
    final bd = DateTime.tryParse('${b.raw['delivered_at']}') ?? DateTime(0);
    return bd.compareTo(ad);
  });
  return past;
});