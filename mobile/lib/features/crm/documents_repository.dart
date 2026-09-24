import '../../core/api/api_client.dart';
import '../../core/auth/auth.dart';

/// Lightweight quote / invoice counts for the home dashboard.
class DocumentsSnapshot {
  const DocumentsSnapshot({
    required this.quotationByStatus,
    required this.invoiceCount,
    required this.quotationCount,
  });

  final Map<String, int> quotationByStatus;
  final int invoiceCount;
  final int quotationCount;

  static const empty = DocumentsSnapshot(
    quotationByStatus: {},
    invoiceCount: 0,
    quotationCount: 0,
  );
}

class DocumentsRepository {
  Future<DocumentsSnapshot> fetchSnapshot() async {
    final orgId = authController.activeOrgId;
    if (orgId == null) return DocumentsSnapshot.empty;

    final data = await apiClient.get<Map<String, dynamic>>(
      '/v1/orgs/$orgId/quotations',
      query: {'doc': 'all'},
    );
    final items = data['items'];
    if (items is! List) return DocumentsSnapshot.empty;

    final byStatus = <String, int>{};
    var invoices = 0;
    var quotations = 0;

    for (final raw in items) {
      if (raw is! Map) continue;
      final invoiceNumber = raw['invoice_number'];
      final isInvoice =
          invoiceNumber is String && invoiceNumber.trim().isNotEmpty;
      if (isInvoice) {
        invoices += 1;
      } else {
        quotations += 1;
        final status = (raw['status'] as String?)?.toUpperCase() ?? 'DRAFT';
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }
    }

    return DocumentsSnapshot(
      quotationByStatus: byStatus,
      invoiceCount: invoices,
      quotationCount: quotations,
    );
  }
}

final documentsRepository = DocumentsRepository();
