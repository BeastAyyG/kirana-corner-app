/// Mirrors the web ApiError: HTTP status + backend error code + message.
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  final dynamic details;

  ApiException(this.status, this.code, this.message, [this.details]);

  bool get isNetwork => status == 0;

  @override
  String toString() => message;
}