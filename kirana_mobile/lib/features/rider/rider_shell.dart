import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import 'account_screen.dart';
import 'duty_screen.dart';
import 'earnings_screen.dart';
import 'jobs_screen.dart';
import 'rider_location.dart';
import 'rider_providers.dart';
import 'rider_widgets.dart';

/// True while an availability flip is in flight (disables all duty switches).
final riderDutyBusyProvider = StateProvider<bool>((ref) => false);

/// Shared duty-toggle action: flips availability, refreshes jobs and reports.
Future<void> toggleDuty(BuildContext context, WidgetRef ref, bool online) async {
  if (ref.read(riderDutyBusyProvider)) return;
  ref.read(riderDutyBusyProvider.notifier).state = true;
  try {
    final nowOnline = await ref.read(riderProfileProvider.notifier).setOnline(online);
    if (nowOnline) {
      ref.read(riderLocationServiceProvider).start();
    } else {
      ref.read(riderLocationServiceProvider).stop();
    }
    if (context.mounted) {
      showRiderSnack(context, nowOnline ? 'You are online — offers incoming' : 'You are offline. Take a break!');
    }
  } on ApiException catch (e) {
    if (context.mounted) showRiderSnack(context, e.message, error: true);
  } catch (_) {
    if (context.mounted) showRiderSnack(context, 'Could not change availability', error: true);
  } finally {
    ref.read(riderDutyBusyProvider.notifier).state = false;
  }
}

/// Rider app shell: green top bar with duty toggle, 4-tab bottom navigation
/// (Duty / Jobs / Earnings / Account), periodic job + earnings polling and
/// the online-only GPS location ping.
class RiderShell extends ConsumerStatefulWidget {
  const RiderShell({super.key});
  @override
  ConsumerState<RiderShell> createState() => _RiderShellState();
}

class _RiderShellState extends ConsumerState<RiderShell> {
  static const Duration jobsPoll = Duration(seconds: 10);
  static const Duration earningsPoll = Duration(seconds: 30);

  Timer? _jobsTimer;
  Timer? _earningsTimer;
  RiderLocationService? _locationService;

  @override
  void initState() {
    super.initState();
    _locationService = ref.read(riderLocationServiceProvider);
    _jobsTimer = Timer.periodic(jobsPoll, (_) {
      if (mounted) ref.read(riderJobsProvider.notifier).refresh(silent: true);
    });
    _earningsTimer = Timer.periodic(earningsPoll, (_) {
      if (mounted) ref.read(riderEarningsProvider.notifier).refresh(silent: true);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final online = ref.read(riderProfileProvider).valueOrNull?.isOnline ?? false;
      if (online) ref.read(riderLocationServiceProvider).start();
    });
  }

  @override
  void dispose() {
    _jobsTimer?.cancel();
    _earningsTimer?.cancel();
    _locationService?.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Start/stop the GPS ping whenever presence changes (also covers toggles
    // made from other screens and server-side availability changes).
    ref.listen(riderProfileProvider, (prev, next) {
      final online = next.valueOrNull?.isOnline ?? false;
      final service = ref.read(riderLocationServiceProvider);
      if (online) {
        service.start();
      } else {
        service.stop();
      }
    });

    final tab = ref.watch(riderTabProvider);
    final profile = ref.watch(riderProfileProvider).valueOrNull;
    final online = profile?.isOnline ?? false;
    final busy = ref.watch(riderDutyBusyProvider);
    final todayTotal = ref.watch(riderEarningsProvider).valueOrNull?.today.totalMinor ?? 0;
    final offerCount = ref.watch(riderOffersProvider).length;
    final name = profile?.name.isNotEmpty ?? false ? profile!.name : 'Rider';
    final vehicle = profile?.vehicle.isNotEmpty ?? false ? profile!.vehicle : 'Bike';

    return Scaffold(
      backgroundColor: BB.bg,
      body: Column(children: [
        _header(context, name: name, vehicle: vehicle, online: online, busy: busy, todayTotal: todayTotal),
        Expanded(
          child: IndexedStack(
            index: tab,
            children: const [
              DutyScreen(),
              JobsScreen(),
              EarningsScreen(),
              AccountScreen(),
            ],
          ),
        ),
      ]),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: tab,
        onTap: (i) => ref.read(riderTabProvider.notifier).state = i,
        items: [
          const BottomNavigationBarItem(icon: Icon(Icons.home_outlined), activeIcon: Icon(Icons.home), label: 'Duty'),
          BottomNavigationBarItem(
            icon: Badge(
              isLabelVisible: offerCount > 0,
              label: Text('$offerCount'),
              backgroundColor: BB.amber,
              child: const Icon(Icons.delivery_dining_outlined),
            ),
            activeIcon: Badge(
              isLabelVisible: offerCount > 0,
              label: Text('$offerCount'),
              backgroundColor: BB.amber,
              child: const Icon(Icons.delivery_dining),
            ),
            label: 'Jobs',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.account_balance_wallet_outlined),
            activeIcon: Icon(Icons.account_balance_wallet),
            label: 'Earnings',
          ),
          const BottomNavigationBarItem(icon: Icon(Icons.person_outline), activeIcon: Icon(Icons.person), label: 'Account'),
        ],
      ),
    );
  }

  Widget _header(BuildContext context, {required String name, required String vehicle, required bool online, required bool busy, required int todayTotal}) {
    return Container(
      color: BB.cart,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 10, 10),
          child: Row(children: [
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: BB.green, borderRadius: BorderRadius.circular(12)),
              child: Text(name.isNotEmpty ? name[0].toUpperCase() : 'R',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name,
                    maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 3),
                Row(children: [
                  const Icon(Icons.delivery_dining, size: 12, color: BB.lime),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(vehicle,
                        maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: BB.lime, fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(color: online ? BB.green : BB.faint, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 4),
                  Text(online ? 'Online' : 'Offline',
                      style: TextStyle(fontSize: 11, color: online ? BB.lime : Colors.white70, fontWeight: FontWeight.w700)),
                ]),
              ]),
            ),
            InkWell(
              onTap: () => ref.read(riderTabProvider.notifier).state = 2,
              borderRadius: BorderRadius.circular(20),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.account_balance_wallet_outlined, size: 13, color: BB.lime),
                  const SizedBox(width: 5),
                  Text(money(todayTotal),
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.white)),
                ]),
              ),
            ),
            const SizedBox(width: 6),
            Column(children: [
              SizedBox(
                height: 30,
                child: FittedBox(
                  fit: BoxFit.contain,
                  child: Switch(
                    value: online,
                    onChanged: busy ? null : (v) => toggleDuty(context, ref, v),
                    activeColor: Colors.white,
                    activeTrackColor: BB.green,
                    inactiveThumbColor: Colors.white,
                    inactiveTrackColor: Colors.white24,
                  ),
                ),
              ),
              Text(online ? 'On duty' : 'Off duty',
                  style: const TextStyle(fontSize: 9.5, color: Colors.white70, fontWeight: FontWeight.w600)),
            ]),
          ]),
        ),
      ),
    );
  }
}