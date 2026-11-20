import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/art.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'product_screen.dart';
import 'track_screen.dart';

class _Banner {
  final String img, title, sub, cat, cta;
  const _Banner(this.img, this.title, this.sub, this.cat, this.cta);
}

const _banners = [
  _Banner('/img/banners/fresh-vegetables.webp', 'Farm-fresh veggies', 'Hand-picked this morning', 'fruits-vegetables', 'Shop fresh'),
  _Banner('/img/banners/dairy-morning.webp', 'Morning dairy', 'Milk, curd & paneer daily', 'dairy-breakfast', 'Shop dairy'),
  _Banner('/img/banners/daily-staples.webp', 'Stock up & save', 'Atta, rice, dal up to 20% off', 'atta-rice-dal', 'Shop staples'),
];

/// Home: banner carousel, active-order strip, coupon teaser, product rails,
/// category grid and the selected store card.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _pageController = PageController();
  Timer? _bannerTimer;
  int _bannerIndex = 0;

  @override
  void initState() {
    super.initState();
    _bannerTimer = Timer.periodic(const Duration(milliseconds: 4500), (_) {
      if (!_pageController.hasClients) return;
      final next = (_bannerIndex + 1) % _banners.length;
      _pageController.animateToPage(next, duration: const Duration(milliseconds: 420), curve: Curves.easeInOut);
    });
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  void _openCategory(String catId) {
    ref.read(browseCategoryProvider.notifier).state = catId;
    ref.read(customerTabProvider.notifier).state = 1;
  }

  void _openProduct(Product p) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(productId: p.id, initial: p)));
  }

  Future<void> _refresh() async {
    ref.invalidate(homeProductsProvider);
    ref.invalidate(categoriesProvider);
    try {
      await ref.read(cartProvider.notifier).refresh();
    } catch (_) {
      // Basket badge is best-effort on pull-to-refresh.
    }
    await ref.read(homeProductsProvider.future).catchError((_) => <Product>[]);
  }

  @override
  Widget build(BuildContext context) {
    final store = ref.watch(selectedStoreProvider);
    final productsAsync = ref.watch(homeProductsProvider);
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final activeOrder = ref.watch(activeOrderProvider);
    final coupons = ref.watch(couponsProvider).value ?? const <Coupon>[];
    final info = ref.watch(serviceInfoProvider);
    final eta = info?.serviceable == true ? info!.etaMinutes : 15;

    return Scaffold(
      body: Column(children: [
        const CustomerHeader(),
        Expanded(
          child: RefreshIndicator(
            color: BB.green,
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                const SizedBox(height: 12),
                SizedBox(
                  height: 180,
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: _banners.length,
                    onPageChanged: (i) => setState(() => _bannerIndex = i),
                    itemBuilder: (context, i) => Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _BannerCard(banner: _banners[i], onTap: () => _openCategory(_banners[i].cat)),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  for (var i = 0; i < _banners.length; i++)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: i == _bannerIndex ? 16 : 6, height: 6,
                      decoration: BoxDecoration(
                        color: i == _bannerIndex ? BB.green : BB.line,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                ]),
                if (activeOrder != null) _activeOrderStrip(activeOrder),
                if (coupons.isNotEmpty) _couponTeaser(coupons.first),
                productsAsync.when(
                  loading: () => const Padding(padding: EdgeInsets.all(30), child: LoadingView()),
                  error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.invalidate(homeProductsProvider)),
                  data: (products) {
                    final deals = products.where((p) => p.discountPercent > 0).toList()
                      ..sort((a, b) => b.discountPercent.compareTo(a.discountPercent));
                    final fresh = products.where((p) => p.categoryId == 'fruits-vegetables').take(8).toList();
                    final dairy = products.where((p) => p.categoryId == 'dairy-breakfast').take(8).toList();
                    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      ProductRail(title: 'Best deals', products: deals.take(8).toList(), onSeeAll: () => _openCategory(''), onTap: _openProduct),
                      ProductRail(title: 'Fresh vegetables', products: fresh, onSeeAll: () => _openCategory('fruits-vegetables'), onTap: _openProduct),
                      ProductRail(title: 'Dairy & breakfast', products: dairy, onSeeAll: () => _openCategory('dairy-breakfast'), onTap: _openProduct),
                    ]);
                  },
                ),
                if (categories.isNotEmpty) ...[
                  const SectionHeader(title: 'Shop by category'),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 4, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 0.72),
                      itemCount: categories.length > 8 ? 8 : categories.length,
                      itemBuilder: (context, i) {
                        final c = categories[i];
                        return InkWell(
                          onTap: () => _openCategory(c.id),
                          borderRadius: BorderRadius.circular(BB.radius),
                          child: Container(
                            decoration: BoxDecoration(color: BB.card, borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
                            padding: const EdgeInsets.all(6),
                            child: Column(children: [
                              Expanded(child: ArtImage(url: categoryArtUrl(c.id), categoryId: c.id, fit: BoxFit.contain, borderRadius: BorderRadius.circular(8))),
                              const SizedBox(height: 4),
                              Text(c.name, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: BB.ink, height: 1.15)),
                            ]),
                          ),
                        );
                      },
                    ),
                  ),
                ],
                if (store != null) _storeCard(store, info),
                GreenStrip(icon: Icons.verified_user_outlined, text: 'Quality checked · Fair prices · Delivered in $eta minutes'),
              ],
            ),
          ),
        ),
      ]),
    );
  }

  Widget _activeOrderStrip(Order order) {
    final eta = orderEtaMinutes(order);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: AppCard(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrackScreen(orderId: order.id))),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Row(children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(color: BB.greenTint, shape: BoxShape.circle),
            child: const Icon(Icons.pedal_bike_outlined, size: 18, color: BB.greenDark),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Order ${order.publicLabel}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink)),
              Text('${order.status == 'picked_up' ? 'Out for delivery' : 'In progress'}${eta > 0 ? ' · $eta min away' : ''}',
                  style: const TextStyle(fontSize: 11.5, color: BB.sub)),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: BB.sub),
        ]),
      ),
    );
  }

  Widget _couponTeaser(Coupon c) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: InkWell(
          onTap: () => ref.read(customerTabProvider.notifier).state = 2,
          borderRadius: BorderRadius.circular(BB.radius),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            decoration: BoxDecoration(
              color: BB.amberTint, borderRadius: BorderRadius.circular(BB.radius),
              border: Border.all(color: BB.amber.withValues(alpha: .45)),
            ),
            child: Row(children: [
              const Icon(Icons.percent_rounded, size: 18, color: BB.amber),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${c.code} — ${c.description.isNotEmpty ? c.description : 'Save on your order'}',
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: BB.ink)),
                  const Text('Apply at checkout & save more', style: TextStyle(fontSize: 11, color: BB.sub)),
                ]),
              ),
              const Icon(Icons.chevron_right_rounded, color: BB.sub),
            ]),
          ),
        ),
      );

  Widget _storeCard(Store store, ServiceInfo? info) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.storefront_outlined, size: 18, color: BB.greenDark),
              const SizedBox(width: 8),
              Expanded(child: Text(store.name, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: BB.ink))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: store.isOpen && store.acceptingOrders ? BB.greenTint : BB.redTint,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(store.isOpen && store.acceptingOrders ? 'Open' : 'Closed',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                        color: store.isOpen && store.acceptingOrders ? BB.greenDeep : BB.red)),
              ),
            ]),
            if (store.address.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('${store.address}${store.city.isNotEmpty ? ', ${store.city}' : ''}',
                  style: const TextStyle(fontSize: 12, color: BB.sub)),
            ],
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              if (info?.serviceable == true) _chip(Icons.bolt_rounded, info!.promise),
              if (store.distanceKm > 0) _chip(Icons.near_me_outlined, distanceLabel(store.distanceKm)),
              if (store.minOrderMinor > 0) _chip(Icons.shopping_basket_outlined, 'Min order ${money(store.minOrderMinor)}'),
              if (store.freeDeliveryAboveMinor > 0) _chip(Icons.local_shipping_outlined, 'Free delivery above ${money(store.freeDeliveryAboveMinor)}'),
            ]),
          ]),
        ),
      );

  Widget _chip(IconData icon, String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(color: BB.bg, borderRadius: BorderRadius.circular(8)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 12, color: BB.greenDark),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: BB.ink)),
        ]),
      );
}

class _BannerCard extends StatelessWidget {
  final _Banner banner;
  final VoidCallback onTap;
  const _BannerCard({required this.banner, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BB.radiusLg),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(BB.radiusLg),
        child: Stack(fit: StackFit.expand, children: [
          Image.network(
            AppConfig.resolveUrl(banner.img),
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Container(
              decoration: const BoxDecoration(gradient: LinearGradient(colors: [BB.greenDeep, BB.green], begin: Alignment.topLeft, end: Alignment.bottomRight)),
            ),
          ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [Color(0x14000000), Color(0xB3000000)], stops: [0.35, 1]),
            ),
          ),
          Positioned(
            left: 14, top: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: .92), borderRadius: BorderRadius.circular(20)),
              child: const Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.eco_outlined, size: 12, color: BB.greenDark),
                SizedBox(width: 4),
                Text('Kirana Fresh', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: BB.greenDeep)),
              ]),
            ),
          ),
          Positioned(
            left: 14, right: 14, bottom: 12,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(banner.title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: Colors.white)),
              const SizedBox(height: 2),
              Text(banner.sub, style: const TextStyle(fontSize: 12, color: Colors.white70)),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(banner.cta, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: BB.greenDeep)),
                  const SizedBox(width: 4),
                  const Icon(Icons.arrow_forward_rounded, size: 13, color: BB.greenDeep),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}