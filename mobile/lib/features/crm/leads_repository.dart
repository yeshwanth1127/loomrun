import '../../core/api/api_client.dart';
import '../../core/auth/auth.dart';
import 'models/lead.dart';

/// CRM lead calls against the existing FastAPI routes.
class LeadsRepository {
  LeadsRepository({ApiClient? client}) : _client = client ?? apiClient;

  final ApiClient _client;

  String? get _orgId => authController.activeOrgId;

  bool get _isLiveOrg {
    final id = _orgId;
    return id != null && id.isNotEmpty && id != 'mock-org';
  }

  Future<List<Lead>> list({
    String? search,
    LeadStage? stage,
    LeadSource? source,
    int? scoreMin,
    int? scoreMax,
    String? lastCallOutcome,
    bool? hasFollowUp,
    String day = 'all',
    bool includeLastCall = true,
  }) async {
    if (!_isLiveOrg) return const [];

    final orgId = _orgId!;

    final query = <String, String>{
      'day': day,
      'include_last_call': includeLastCall ? 'true' : 'false',
    };
    if (search != null && search.trim().isNotEmpty) {
      query['search'] = search.trim();
    }
    if (stage != null) query['stage'] = stage.apiValue;
    if (source != null) query['source'] = source.apiValue;
    if (scoreMin != null) query['score_min'] = '$scoreMin';
    if (scoreMax != null) query['score_max'] = '$scoreMax';
    if (lastCallOutcome != null && lastCallOutcome.isNotEmpty) {
      query['last_call_outcome'] = lastCallOutcome;
    }
    if (hasFollowUp == true) query['has_follow_up'] = 'true';

    final data = await _client.get<Map<String, dynamic>>(
      '/v1/orgs/$orgId/leads',
      query: query,
    );
    final items = data['items'] as List<dynamic>? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(Lead.fromApi)
        .toList();
  }

  Future<Lead> getById(String leadId) async {
    final orgId = _requireOrg();
    final data = await _client.get<Map<String, dynamic>>(
      '/v1/orgs/$orgId/leads/$leadId',
    );
    return Lead.fromApi(data);
  }

  Future<Lead> create({
    required String title,
    LeadSource source = LeadSource.manual,
    LeadStage stage = LeadStage.newLead,
    String? company,
    String? phone,
    String? email,
    String? city,
    double? estimatedValue,
    String? notes,
  }) async {
    final orgId = _requireOrg();
    final data = await _client.post<Map<String, dynamic>>(
      '/v1/orgs/$orgId/leads',
      json: {
        'title': title,
        'source': source.apiValue,
        'stage': stage.apiValue,
        if (company != null && company.isNotEmpty) 'company': company,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
        if (email != null && email.isNotEmpty) 'email': email,
        if (city != null && city.isNotEmpty) 'city': city,
        if (estimatedValue != null) 'estimated_value': estimatedValue,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return Lead.fromApi(data);
  }

  Future<Lead> update(
    String leadId, {
    LeadStage? stage,
    DateTime? nextFollowUpAt,
    bool clearNextFollowUp = false,
    String? notes,
    String? title,
    String? company,
    String? phone,
    String? city,
    double? estimatedValue,
  }) async {
    final orgId = _requireOrg();
    final body = <String, dynamic>{};
    if (stage != null) body['stage'] = stage.apiValue;
    if (clearNextFollowUp) {
      body['next_follow_up_at'] = null;
    } else if (nextFollowUpAt != null) {
      body['next_follow_up_at'] = nextFollowUpAt.toUtc().toIso8601String();
    }
    if (notes != null) body['notes'] = notes;
    if (title != null) body['title'] = title;
    if (company != null) body['company'] = company;
    if (phone != null) body['phone'] = phone;
    if (city != null) body['city'] = city;
    if (estimatedValue != null) body['estimated_value'] = estimatedValue;

    final data = await _client.patch<Map<String, dynamic>>(
      '/v1/orgs/$orgId/leads/$leadId',
      json: body,
    );
    return Lead.fromApi(data);
  }

  String _requireOrg() {
    final orgId = _orgId;
    if (orgId == null || orgId.isEmpty) {
      throw StateError('No active organization. Log in again.');
    }
    return orgId;
  }
}

final leadsRepository = LeadsRepository();
