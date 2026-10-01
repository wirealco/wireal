# The Wireal API for Linux containers, and its database migrations.
#
#   docker build -t wireal-api backend
#
# One image, two uses: the default command serves the API on port 8080, and
# /app/migrate/efbundle applies pending EF Core migrations to the database named
# by ConnectionStrings__Postgres, then exits (the `migrate` service in the root
# docker-compose.yml). Both run as the image's non-root `app` user.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
# The runtime identifier for the platform being built (amd64 or arm64).
RUN case "$TARGETARCH" in arm64) echo linux-arm64 ;; *) echo linux-x64 ;; esac > /rid
# global.json pins the SDK the Windows CI uses; this image brings its own 10.0
# SDK, so the pin is dropped here rather than failing on a feature band.
COPY .config/dotnet-tools.json .config/
COPY Wireal.Api/Wireal.Api.csproj Wireal.Api/
RUN dotnet restore Wireal.Api/Wireal.Api.csproj -r "$(cat /rid)" && dotnet tool restore
COPY Wireal.Api/ Wireal.Api/
RUN dotnet publish Wireal.Api/Wireal.Api.csproj -c Release -r "$(cat /rid)" --self-contained false --no-restore -o /out/api
RUN dotnet ef migrations bundle --project Wireal.Api --context AppDbContext --configuration Release \
      --self-contained -r "$(cat /rid)" --force -o /out/migrate/efbundle

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# Data Protection keys and log files live on volumes; creating the directories
# here gives a fresh named volume the right owner.
RUN mkdir -p /var/lib/wireal/keys /var/lib/wireal/logs && chown -R $APP_UID /var/lib/wireal
COPY --from=build /out/api/ /app/
COPY --from=build /out/migrate/ /app/migrate/
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    Security__KeyDirectory=/var/lib/wireal/keys \
    Logging__Directory=/var/lib/wireal/logs
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Wireal.Api.dll"]
