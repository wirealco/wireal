namespace Wireal.Api.Logging;

public static class LogOutput
{
    // Both standard Serilog sinks render the same structured events as text.
    public const string Template = "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] [{SourceContext}] {Message:lj}{NewLine}{Exception}";
}
