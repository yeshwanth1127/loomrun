/// Error thrown by [ApiClient] when the backend returns a non-success status
/// or the response cannot be parsed.
class ApiException implements Exception {
  final String message;
  final int? statusCode;

  const ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}
