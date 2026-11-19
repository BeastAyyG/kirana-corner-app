import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'product_screen.dart';

/// Saved-for-later items grid with remove + add-to-basket.
class SavedScreen extends ConsumerStatefulWidget {
  const SavedScreen({super.key});

  @override
  ConsumerState<SavedScreen> createState() => _SavedScreenState();
}

class _SavedScreenState extends ConsumerState<SavedScreen> {
  String _error = '';

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _error = '');
    try {
      await ref.read(savedProvider.notifier).refresh();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _remove(Product p) async {
    final storeId = p.storeId.isNotEmpty ? p.storeId : ref.read(selectedStoreProvider)?.id ?? '';
    try {
      await ref.read(savedProvider.notifier).toggle(storeId, p.id);
      if (mounted) showSnack(context, 'Removed from saved');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final saved = ref.watch(savedProvider);
    final cart = ref.watch(cartProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Saved items')),
      body: _error.isNotEmpty && saved == null
          ? ErrorView(message: _error, onRetry: _refresh)
          : saved == null
              ? const LoadingView()
              : saved.isEmpty
                  ? EmptyState(
                      icon: Icons.favorite_border_rounded,
                      title: 'No saved items yet',
                      subtitle: 'Tap the heart on any product to keep it here for later.',
                      action: PrimaryButton(
                        label: 'Browse products',
                        onPressed: () {
                          Navigator.pop(context);
                          ref.read(customerTabProvider.notifier).state = 1;
                        },
                      ),
                    )
                  : RefreshIndicator(
                      color: BB.green,
                      onRefresh: _refresh,
                      child: GridView.builder(
                        padding: const EdgeInsets.all(16),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 0.60),
                        itemCount: saved.length,
                        itemBuilder: (context, i) {
                          final p = saved[i];
                          return Stack(children: [
                            Positioned.fill(
                              child: ProductCard(
                                product: p,
                                quantity: cartQtyOf(cart, p.id),
                                onQuantity: (q) => updateCartQty(context, ref, p.id, q),
                                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(productId: p.id, initial: p))),
                              ),
                            ),
                            Positioned(
                              right: 6, top: 6,
                              child: InkWell(
                                onTap: () => _remove(p),
                                borderRadius: BorderRadius.circular(16),
                                child: Container(
                                  padding: const EdgeInsets.all(5),
                                  decoration: const BoxDecoration(color: BB.card, shape: BoxShape.circle, boxShadow: BB.shadow),
                                  child: const Icon(Icons.favorite_rounded, size: 16, color: BB.red),
                                ),
                              ),
                            ),
                          ]);
                        },
                      ),
                    ),
    );
  }
}