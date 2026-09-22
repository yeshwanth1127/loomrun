/// The three tabs on the web Follow ups page.
enum FollowUpTab {
  all,
  dueToday,
  overdue;

  String get label => switch (this) {
        FollowUpTab.all => 'All follow ups',
        FollowUpTab.dueToday => 'Due today',
        FollowUpTab.overdue => 'Overdue',
      };
}

/// Whether a follow-up converted into pipeline commerce.
enum FollowUpOutcome { pending, quote, order }

class FollowUp {
  final String id;

  /// Links back to the lead / customer.
  final String leadId;
  final String customerName;
  final String company;
  final String phone;

  final DateTime dateTime;

  /// The action to take, e.g. "Call to confirm greige specs".
  final String action;

  /// Optional related quotation / order reference.
  final String? relatedRef;

  final bool highPriority;
  final FollowUpOutcome outcome;

  const FollowUp({
    required this.id,
    required this.leadId,
    required this.customerName,
    required this.company,
    required this.phone,
    required this.dateTime,
    required this.action,
    this.relatedRef,
    this.highPriority = false,
    this.outcome = FollowUpOutcome.pending,
  });

  bool get converted => outcome != FollowUpOutcome.pending;

  bool isOverdue(DateTime now) => _dateOnly(dateTime).isBefore(_dateOnly(now));

  bool isDueToday(DateTime now) =>
      _dateOnly(dateTime).isAtSameMomentAs(_dateOnly(now));

  bool isUpcoming(DateTime now) => _dateOnly(dateTime).isAfter(_dateOnly(now));
}

DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

bool sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

const _monthsUpper = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', //
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];
const _weekdaysUpper = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/// "10:30 AM"
String formatTime(DateTime dt) {
  final hour12 = dt.hour == 0
      ? 12
      : dt.hour > 12
          ? dt.hour - 12
          : dt.hour;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour < 12 ? 'AM' : 'PM';
  return '$hour12:$minute $period';
}

/// "1 day overdue" / "3 days overdue"
String overdueLabel(DateTime dt, DateTime now) {
  final days = _dateOnly(now).difference(_dateOnly(dt)).inDays;
  if (days <= 1) return '1 day overdue';
  return '$days days overdue';
}

/// TODAY / TOMORROW / YESTERDAY / "WED 10 SEP"
String dateSectionLabel(DateTime date, DateTime now) {
  final diff = _dateOnly(date).difference(_dateOnly(now)).inDays;
  if (diff == 0) return 'TODAY';
  if (diff == 1) return 'TOMORROW';
  if (diff == -1) return 'YESTERDAY';
  final weekday = _weekdaysUpper[date.weekday - 1];
  return '$weekday ${date.day} ${_monthsUpper[date.month - 1]}';
}
