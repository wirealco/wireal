using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class RateLimitTests
{
    [Fact]
    public async Task LoginBucketsFollowTheVisitorBehindTheProxyAndRejectTheEleventhAttempt()
    {
        await using var factory = new ApiFactory(connectionAddress: "127.0.0.1");
        using var first = Visitor(factory, "203.0.113.10");
        using var second = Visitor(factory, "198.51.100.20");
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.Redirect, (await Login(factory, first)).StatusCode);
        var rejected = await Login(factory, first);
        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.NotNull(rejected.Headers.RetryAfter);
        Assert.True(rejected.Headers.RetryAfter!.Delta > TimeSpan.Zero);
        // A different visitor through the same edge keeps its own bucket.
        Assert.Equal(HttpStatusCode.Redirect, (await Login(factory, second)).StatusCode);
    }

    [Fact]
    public async Task VisitorHeaderIsIgnoredWhenTheConnectionIsNotFromAKnownProxy()
    {
        await using var factory = new ApiFactory(connectionAddress: "10.0.0.5");
        using var first = Visitor(factory, "203.0.113.10");
        using var second = Visitor(factory, "198.51.100.20");
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.Redirect, (await Login(factory, first)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Login(factory, second)).StatusCode);
    }

    [Fact]
    public async Task SignedInApiBucketIsKeyedByUserNotByAddress()
    {
        await using var factory = new ApiFactory(connectionAddress: "127.0.0.1");
        await factory.InitializeDatabaseAsync();
        var (signedIn, _) = await ProjectFlowTests.SignIn(factory);
        var (otherUser, _) = await ProjectFlowTests.SignIn(factory);
        using (signedIn) using (otherUser)
        {
            using var home = Visitor(factory, "203.0.113.10", signedIn.DefaultRequestHeaders.Authorization!.Parameter);
            using var office = Visitor(factory, "198.51.100.20", signedIn.DefaultRequestHeaders.Authorization!.Parameter);
            using var neighbour = Visitor(factory, "203.0.113.10", otherUser.DefaultRequestHeaders.Authorization!.Parameter);
            // The bucket refills 10 tokens a second while the loop runs, so drain until the first rejection; each request
            // reads PostgreSQL, so the cap leaves room for a slow machine to need far more than 600 requests.
            HttpResponseMessage? rejected = null;
            for (var i = 0; i < 3000 && rejected is null; i++)
            {
                var response = await home.GetAsync("/api/workspace-changes");
                if (response.StatusCode == HttpStatusCode.TooManyRequests) rejected = response;
                else Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            }
            Assert.NotNull(rejected);
            Assert.NotNull(rejected!.Headers.RetryAfter);
            // Same user from another address shares the drained bucket: a per-address bucket would allow 600 more.
            var statuses = new List<HttpStatusCode>();
            for (var i = 0; i < 30; i++) statuses.Add((await office.GetAsync("/api/workspace-changes")).StatusCode);
            Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
            // Another user from the drained address is unaffected.
            Assert.Equal(HttpStatusCode.OK, (await neighbour.GetAsync("/api/workspace-changes")).StatusCode);
        }
    }

    [Fact]
    public async Task ForgedBearerTokenFallsBackToTheAddressBucket()
    {
        await using var factory = new ApiFactory(connectionAddress: "127.0.0.1");
        await factory.InitializeDatabaseAsync();
        using var client = Visitor(factory, "203.0.113.10", "not.a.token");
        for (var i = 0; i < 120; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/workspace-changes")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/workspace-changes")).StatusCode);
    }

    /// <summary>A client whose requests Cloudflare stamped with the given visitor address.</summary>
    private static HttpClient Visitor(ApiFactory factory, string address, string? bearer = null)
    {
        var client = factory.Client();
        client.DefaultRequestHeaders.Add("CF-Connecting-IP", address);
        if (bearer is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return client;
    }

    /// <summary>Starts the GitHub sign-in, the cheapest endpoint on the "login" policy.</summary>
    private static Task<HttpResponseMessage> Login(ApiFactory factory, HttpClient client)
    {
        factory.PrepareGitHub(client);
        return client.GetAsync("/auth/github");
    }
}
