import 'package:flutter/foundation.dart';

import 'models/follow_up.dart';

/// Frontend-only in-memory follow-up store.
class FollowUpsController extends ChangeNotifier {
  FollowUpsController() {
    final now = DateTime.now();
    DateTime at(int dayOffset, int hour, int minute) => DateTime(
          now.year,
          now.month,
          now.day + dayOffset,
          hour,
          minute,
        );

    _followUps.addAll([
      // Overdue
      FollowUp(
        id: 'fu-1',
        leadId: 'lead-3',
        customerName: 'Nikhil Rao',
        company: 'Welspun India',
        phone: '+91 98330 22114',
        dateTime: at(-1, 11, 0),
        action: 'Follow up on quotation response',
        relatedRef: 'QT-418',
        highPriority: true,
      ),
      FollowUp(
        id: 'fu-2',
        leadId: 'lead-8',
        customerName: 'Deepak Joshi',
        company: 'RSWM Ltd',
        phone: '+91 94140 88123',
        dateTime: at(-3, 15, 0),
        action: 'Re-engage after no reply for two weeks',
      ),
      // Due today
      FollowUp(
        id: 'fu-3',
        leadId: 'lead-2',
        customerName: 'Sunita Desai',
        company: 'Arvind Mills',
        phone: '+91 99201 44556',
        dateTime: at(0, 10, 30),
        action: 'Confirm greige fabric specifications',
        relatedRef: 'QT-419',
        highPriority: true,
        outcome: FollowUpOutcome.quote,
      ),
      FollowUp(
        id: 'fu-4',
        leadId: 'lead-1',
        customerName: 'Raghu',
        company: 'Exora Solutions',
        phone: '+91 98450 11223',
        dateTime: at(0, 14, 0),
        action: 'Share revised pricing and catalogue',
      ),
      FollowUp(
        id: 'fu-5',
        leadId: 'lead-4',
        customerName: 'Priya Nair',
        company: 'Vardhman Textiles',
        phone: '+91 90080 91234',
        dateTime: at(0, 16, 30),
        action: 'Call about sample dispatch timeline',
      ),
      // Upcoming
      FollowUp(
        id: 'fu-6',
        leadId: 'lead-5',
        customerName: 'Lakshmi Iyer',
        company: 'KPR Mill',
        phone: '+91 97890 55321',
        dateTime: at(1, 9, 30),
        action: 'Present quotation and payment terms',
        relatedRef: 'QT-430',
      ),
      FollowUp(
        id: 'fu-7',
        leadId: 'lead-6',
        customerName: 'Ashok Menon',
        company: 'Raymond Ltd',
        phone: '+91 98110 77654',
        dateTime: at(2, 15, 0),
        action: 'Negotiate volume discount',
        relatedRef: 'Order #9024',
        outcome: FollowUpOutcome.order,
      ),
      FollowUp(
        id: 'fu-8',
        leadId: 'lead-7',
        customerName: 'Farah Khan',
        company: 'Bombay Dyeing',
        phone: '+91 99870 33221',
        dateTime: at(6, 11, 0),
        action: 'Post-delivery quality check-in',
      ),
    ]);
  }

  final List<FollowUp> _followUps = [];
  String _query = '';

  String get query => _query;

  set query(String value) {
    _query = value;
    notifyListeners();
  }

  List<FollowUp> get all {
    final sorted = [..._followUps]
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
    return List.unmodifiable(sorted);
  }

  int get scheduledCount => _followUps.length;

  List<FollowUp> overdue(DateTime now) =>
      all.where((f) => f.isOverdue(now)).toList();

  List<FollowUp> dueToday(DateTime now) =>
      all.where((f) => f.isDueToday(now)).toList();

  List<FollowUp> upcoming(DateTime now) =>
      all.where((f) => f.isUpcoming(now)).toList();

  int get convertedToQuotes =>
      _followUps.where((f) => f.outcome == FollowUpOutcome.quote).length;

  int get convertedToOrders =>
      _followUps.where((f) => f.outcome == FollowUpOutcome.order).length;

  /// Whole-number conversion percentage.
  int get conversionPercent {
    if (_followUps.isEmpty) return 0;
    final converted = _followUps.where((f) => f.converted).length;
    return (converted * 100 / _followUps.length).round();
  }

  /// Entries for a tab, with the search query applied.
  List<FollowUp> forTab(FollowUpTab tab, DateTime now) {
    final base = switch (tab) {
      FollowUpTab.all => all,
      FollowUpTab.dueToday => dueToday(now),
      FollowUpTab.overdue => overdue(now),
    };
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return base;
    return base
        .where((f) =>
            f.customerName.toLowerCase().contains(q) ||
            f.company.toLowerCase().contains(q) ||
            f.phone.toLowerCase().contains(q) ||
            f.action.toLowerCase().contains(q))
        .toList();
  }

  int tabCount(FollowUpTab tab, DateTime now) => switch (tab) {
        FollowUpTab.all => _followUps.length,
        FollowUpTab.dueToday => dueToday(now).length,
        FollowUpTab.overdue => overdue(now).length,
      };

  void add(FollowUp followUp) {
    _followUps.add(followUp);
    notifyListeners();
  }
}

final followUpsController = FollowUpsController();
