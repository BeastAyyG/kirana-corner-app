// Promotions: coupon ledger with create / edit / pause flows. Type, value and
// validity window are fixed after creation (backend rule) — edit only touches
// the description and active flag, exactly like the web view.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';
import 'coupon_form_screen.dart';

class CouponsScreen extends ConsumerStatefulWidget {
  const CouponsScreen({super.key});
  @override
  ConsumerState<CouponsScreen> createState() => _CouponsScreenState();
}

class _CouponsScreenState extends ConsumerState<CouponsScreen> {
  String _search = '';
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<AdminCoupon> _filtered(List<AdminCoupon> coupons) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return coupons;
    return coupons
        .where((c) => c.code.toLowerCase().contains(q) || c.description.toLowerCase().contains(q) || c.type.contains(q))
        .toList();
  }

  Future<void> _newCoupon() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CouponFormScreen()));
  }

  Future<void> _editCoupon(AdminCoupon coupon) async {
    final controller = TextEditingController(text: coupon.description);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BB.card,
        title: Text('Edit ${coupon.code}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text(
            'Type, value and window are fixed after creation. Pause and recreate to change them.',
            style: TextStyle(fontSize: 12.5, color: BB.sub, height: 1.4),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            maxLength: 160,
            autofocus: true,
            style: const TextStyle(fontSize: 14, color: BB.ink),
            decoration: const InputDecoration(labelText: 'Description'),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Discard')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Save changes', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
    final description = controller.text.trim();
    controller.dispose();
    if (saved != true || !mounted) return;
    try {
      await ref.read(apiProvider).adminUpdateCoupon(coupon.id, {'description': description});
      ref.invalidate(adminCouponsProvider);
      if (mounted) showAdminSnack(context, 'Coupon updated');
    } catch (error) {
      if (mounted) showAdminSnack(context, adminErrorMessage(error, 'Could not update the coupon'), isError: true);
    }
  }

  Future<void> _toggleCoupon(AdminCoupon coupon) async {
    final pausing = coupon.active;
    final ok = await confirmAction(
      context,
      title: '${pausing ? 'Pause' : 'Activate'} ${coupon.code}?',
      message: pausing
          ? 'Customers can no longer apply this code. Existing orders keep their discount.'
          : 'The code becomes applyable again within its validity window.',
      confirmLabel: pausing ? 'Pause coupon' : 'Activate coupon',
      danger: pausing,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiProvider).adminUpdateCoupon(coupon.id, {'active': !pausing});
      ref.invalidate(adminCouponsProvider);
      if (mounted) showAdminSnack(context, pausing ? 'Coupon paused' : 'Coupon activated');
    } catch (error) {
      if (mounted) showAdminSnack(context, adminErrorMessage(error, 'Could not update the coupon'), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final couponsAsync = ref.watch(adminCouponsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Coupons'), actions: [
        RefreshAction(onPressed: () => ref.invalidate(adminCouponsProvider)),
        IconButton(
          onPressed: _newCoupon,
          icon: const Icon(Icons.add_circle_rounded, color: BB.greenDark),
          tooltip: 'New coupon',
        ),
      ]),
      body: Column(children: [
        AdminSearchBox(
          controller: _searchController,
          placeholder: 'Search code or description…',
          onChanged: (v) => setState(() => _search = v),
        ),
        Expanded(
          child: couponsAsync.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              message: adminErrorMessage(e, 'Could not load coupons'),
              onRetry: () => ref.invalidate(adminCouponsProvider),
            ),
            data: (coupons) {
              final list = _filtered(coupons);
              if (list.isEmpty) {
                return EmptyState(
                  icon: Icons.local_offer_rounded,
                  title: _search.isNotEmpty ? 'No matching coupons' : 'No coupons yet',
                  subtitle: _search.isNotEmpty ? 'Try a different code or description.' : 'Create a welcome offer to drive first orders.',
                  action: _search.isNotEmpty
                      ? null
                      : PrimaryButton(label: 'New coupon', icon: Icons.add_rounded, onPressed: _newCoupon),
                );
              }
              return RefreshIndicator(
                color: BB.green,
                onRefresh: () async => ref.refresh(adminCouponsProvider.future),
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  itemCount: list.length + 1,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Text('${list.length} of ${coupons.length} coupons', style: const TextStyle(fontSize: 11.5, color: BB.faint));
                    }
                    final coupon = list[index - 1];
                    return _CouponCard(
                      coupon: coupon,
                      onEdit: () => _editCoupon(coupon),
                      onToggle: () => _toggleCoupon(coupon),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _CouponCard extends StatelessWidget {
  final AdminCoupon coupon;
  final VoidCallback onEdit;
  final VoidCallback onToggle;
  const _CouponCard({required this.coupon, required this.onEdit, required this.onToggle});

  static const _typeColors = {
    'flat': [BB.greenTint, BB.greenDeep],
    'percent': [BB.blueTint, BB.blue],
    'free_delivery': [BB.amberTint, BB.amber],
  };

  static const _stateColors = {
    'Live': [BB.greenTint, BB.greenDeep],
    'Paused': [BB.line, BB.sub],
    'Expired': [BB.redTint, BB.red],
    'Scheduled': [BB.blueTint, BB.blue],
  };

  @override
  Widget build(BuildContext context) {
    final typeColors = _typeColors[coupon.type] ?? const [BB.line, BB.sub];
    final state = coupon.stateLabel;
    final stateColors = _stateColors[state] ?? const [BB.line, BB.sub];
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: BB.greenTint,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: BB.green.withValues(alpha: .4)),
            ),
            child: Text(coupon.code, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 1, color: BB.greenDeep)),
          ),
          const Spacer(),
          Pill(label: state, bg: stateColors[0], fg: stateColors[1]),
        ]),
        if (coupon.description.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(coupon.description, style: const TextStyle(fontSize: 12, color: BB.sub)),
          ),
        const SizedBox(height: 8),
        Wrap(spacing: 4, runSpacing: 4, children: [
          Pill(label: coupon.typeLabel, bg: typeColors[0], fg: typeColors[1]),
          Pill(label: coupon.valueLabel, bg: BB.line, fg: BB.ink),
        ]),
        const SizedBox(height: 8),
        InfoRow(label: 'Minimum order', value: money(coupon.minOrderMinor)),
        InfoRow(label: 'Max discount', value: coupon.maxDiscountMinor > 0 ? money(coupon.maxDiscountMinor) : '—'),
        InfoRow(label: 'Window', value: '${dateShort(coupon.startsAt)} → ${dateShort(coupon.endsAt)}'),
        InfoRow(label: 'Used', value: '${coupon.usedCount} / ${coupon.usageLimit} · ${coupon.perUserLimit} per user'),
        const SizedBox(height: 4),
        Row(children: [
          TextButton.icon(
            onPressed: onEdit,
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
            icon: const Icon(Icons.edit_rounded, size: 15),
            label: const Text('Edit', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: onToggle,
            style: TextButton.styleFrom(
              foregroundColor: coupon.active ? BB.red : BB.greenDark,
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
            icon: Icon(coupon.active ? Icons.pause_circle_rounded : Icons.play_circle_rounded, size: 15),
            label: Text(coupon.active ? 'Pause' : 'Activate', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
        ]),
      ]),
    );
  }
}