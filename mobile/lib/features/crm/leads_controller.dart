import 'package:flutter/foundation.dart';

import 'models/lead.dart';

/// Active filter state for the Leads screen.
class LeadFilters {
  final String query;
  final LeadSource? source;
  final LeadStage? stage;
  final int? scoreMin;
  final int? scoreMax;
  final bool showClosed;

  const LeadFilters({
    this.query = '',
    this.source,
    this.stage,
    this.scoreMin,
    this.scoreMax,
    this.showClosed = false,
  });

  LeadFilters copyWith({
    String? query,
    LeadSource? source,
    LeadStage? stage,
    int? scoreMin,
    int? scoreMax,
    bool? showClosed,
    bool clearSource = false,
    bool clearStage = false,
    bool clearScoreMin = false,
    bool clearScoreMax = false,
  }) {
    return LeadFilters(
      query: query ?? this.query,
      source: clearSource ? null : (source ?? this.source),
      stage: clearStage ? null : (stage ?? this.stage),
      scoreMin: clearScoreMin ? null : (scoreMin ?? this.scoreMin),
      scoreMax: clearScoreMax ? null : (scoreMax ?? this.scoreMax),
      showClosed: showClosed ?? this.showClosed,
    );
  }

  bool get hasAdvanced =>
      source != null ||
      stage != null ||
      scoreMin != null ||
      scoreMax != null;
}

/// Frontend-only in-memory lead store.
class LeadsController extends ChangeNotifier {
  LeadsController() {
    final now = DateTime.now();
    DateTime ago(Duration d) => now.subtract(d);

    _leads.addAll([
      Lead(
        id: 'lead-1',
        name: 'Raghu',
        company: 'Exora Solutions',
        phone: '+91 98450 11223',
        location: 'Bangalore',
        source: LeadSource.whatsapp,
        score: 50,
        status: 'Busy',
        stage: LeadStage.newLead,
        value: 10000,
        lastActivity: ago(const Duration(minutes: 50)),
      ),
      Lead(
        id: 'lead-2',
        name: 'Sunita Desai',
        company: 'Arvind Mills',
        phone: '+91 99201 44556',
        location: 'Ahmedabad',
        source: LeadSource.referral,
        score: 82,
        status: 'Interested',
        stage: LeadStage.contacted,
        value: 620000,
        lastActivity: ago(const Duration(hours: 5)),
      ),
      Lead(
        id: 'lead-3',
        name: 'Nikhil Rao',
        company: 'Welspun India',
        phone: '+91 98330 22114',
        location: 'Mumbai',
        source: LeadSource.website,
        score: 34,
        status: 'Callback',
        stage: LeadStage.contacted,
        value: 85000,
        lastActivity: ago(const Duration(hours: 26)),
      ),
      Lead(
        id: 'lead-4',
        name: 'Priya Nair',
        company: 'Vardhman Textiles',
        phone: '+91 90080 91234',
        location: 'Ludhiana',
        source: LeadSource.whatsapp,
        score: 76,
        status: 'Requirement shared',
        stage: LeadStage.requirementCollected,
        value: 320000,
        lastActivity: ago(const Duration(hours: 3)),
      ),
      Lead(
        id: 'lead-5',
        name: 'Lakshmi Iyer',
        company: 'KPR Mill',
        phone: '+91 97890 55321',
        location: 'Coimbatore',
        source: LeadSource.phoneCall,
        score: 68,
        status: 'Quote sent',
        stage: LeadStage.quoted,
        value: 780000,
        lastActivity: ago(const Duration(days: 2)),
      ),
      Lead(
        id: 'lead-6',
        name: 'Ashok Menon',
        company: 'Raymond Ltd',
        phone: '+91 98110 77654',
        location: 'Thane',
        source: LeadSource.referral,
        score: 88,
        status: 'Negotiating',
        stage: LeadStage.negotiation,
        value: 1450000,
        lastActivity: ago(const Duration(days: 1)),
      ),
      Lead(
        id: 'lead-7',
        name: 'Farah Khan',
        company: 'Bombay Dyeing',
        phone: '+91 99870 33221',
        location: 'Mumbai',
        source: LeadSource.instagram,
        score: 91,
        status: 'Won',
        stage: LeadStage.won,
        value: 1900000,
        lastActivity: ago(const Duration(days: 4)),
      ),
      Lead(
        id: 'lead-8',
        name: 'Deepak Joshi',
        company: 'RSWM Ltd',
        phone: '+91 94140 88123',
        location: 'Bhilwara',
        source: LeadSource.website,
        score: 22,
        status: 'Not interested',
        stage: LeadStage.lost,
        value: 150000,
        lastActivity: ago(const Duration(days: 8)),
      ),
    ]);
  }

  final List<Lead> _leads = [];
  LeadFilters _filters = const LeadFilters();

  LeadFilters get filters => _filters;

  List<Lead> get all => List.unmodifiable(_leads);

  int get totalCount => _leads.length;

  int get closedCount => _leads.where((l) => l.stage.isClosed).length;

  /// Stages visible on the board, honouring the "Show closed" toggle.
  List<LeadStage> get visibleStages => _filters.showClosed
      ? LeadStage.values
      : LeadStage.open;

  void setFilters(LeadFilters filters) {
    _filters = filters;
    notifyListeners();
  }

  /// Leads matching the active filters.
  /// - Board column: pass `stage` to scope to that column.
  /// - Table view: omit `stage`; honours the Stage dropdown and "Show closed".
  List<Lead> filtered({LeadStage? stage}) {
    final q = _filters.query.trim().toLowerCase();
    return _leads.where((lead) {
      if (stage != null) {
        if (lead.stage != stage) return false;
      } else {
        if (_filters.stage != null && lead.stage != _filters.stage) {
          return false;
        }
        if (!_filters.showClosed &&
            _filters.stage == null &&
            lead.stage.isClosed) {
          return false;
        }
      }
      if (q.isNotEmpty &&
          !lead.name.toLowerCase().contains(q) &&
          !lead.company.toLowerCase().contains(q) &&
          !lead.phone.toLowerCase().contains(q)) {
        return false;
      }
      if (_filters.source != null && lead.source != _filters.source) {
        return false;
      }
      if (_filters.scoreMin != null && lead.score < _filters.scoreMin!) {
        return false;
      }
      if (_filters.scoreMax != null && lead.score > _filters.scoreMax!) {
        return false;
      }
      return true;
    }).toList()
      ..sort((a, b) => b.score.compareTo(a.score));
  }

  int countForStage(LeadStage stage) => filtered(stage: stage).length;

  double valueForStage(LeadStage stage) => filtered(stage: stage)
      .fold(0, (sum, lead) => sum + lead.value);

  void add(Lead lead) {
    _leads.insert(0, lead);
    notifyListeners();
  }

  void moveToStage(String leadId, LeadStage stage) {
    final i = _leads.indexWhere((l) => l.id == leadId);
    if (i == -1) return;
    _leads[i] = _leads[i].copyWith(stage: stage);
    notifyListeners();
  }
}

final leadsController = LeadsController();
