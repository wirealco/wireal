using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class WorkspaceInvitationTests
{
    [Fact]
    public async Task InboxIncludesWorkspaceAndInviterDetails()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (ownerClient, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guestClient, guestId) = await ProjectFlowTests.SignIn(factory);
        using (ownerClient) using (guestClient)
        {
            var workspaceId = Guid.NewGuid();
            var workspace = ProjectFlowTests.Workspace("Design room");
            workspace["map"]!["kind"] = "everyday";
            workspace["map"]!["orb"] = new JsonObject
            {
                ["colors"] = new JsonArray("#123456", "#abcdef", "#fedcba"),
                ["speed"] = 0.65,
                ["distortion"] = 0.75,
                ["swirl"] = 0.55,
                ["phase"] = 20
            };
            await ProjectFlowTests.Query(ownerClient, new
            {
                table = "workspaces",
                operation = "insert",
                values = new { id = workspaceId, data = workspace }
            });

            Guid invitationId;
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owner = await db.Users.FindAsync(ownerId);
                var guest = await db.Users.FindAsync(guestId);
                Assert.NotNull(owner);
                Assert.NotNull(guest);
                owner.DisplayName = "Ada Owner";
                owner.AvatarUrl = "https://example.com/ada.png";
                guest.NormalizedEmail = guest.Email!.ToLowerInvariant();
                var collaborator = new AppUser
                {
                    DisplayName = "Collaborator",
                    Email = "collaborator@example.com",
                    NormalizedEmail = "collaborator@example.com",
                    EmailVerified = true
                };
                db.Users.Add(collaborator);
                db.WorkspaceMembers.Add(new WorkspaceMember
                {
                    WorkspaceId = workspaceId,
                    UserId = collaborator.Id
                });
                var invitationEntity = new WorkspaceInvitation
                {
                    WorkspaceId = workspaceId,
                    InvitedBy = ownerId,
                    Kind = "email",
                    Target = guest.NormalizedEmail,
                    Label = guest.Email,
                    ExpiresAt = DateTime.UtcNow.AddDays(7)
                };
                invitationId = invitationEntity.Id;
                db.WorkspaceInvitations.Add(invitationEntity);
                await db.SaveChangesAsync();
            }

            var response = await guestClient.GetAsync("/api/teams/invitations");
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var inboxInvitation = Assert.Single(JsonNode.Parse(text)!.AsArray())!;
            Assert.Equal(invitationId.ToString(), inboxInvitation["id"]!.GetValue<string>());
            Assert.NotNull(inboxInvitation["expiresAt"]);
            Assert.Equal("Design room", inboxInvitation["workspaceName"]!.GetValue<string>());
            Assert.Equal("everyday", inboxInvitation["workspaceKind"]!.GetValue<string>());
            Assert.Equal(2, inboxInvitation["memberCount"]!.GetValue<int>());
            Assert.Equal("Ada Owner", inboxInvitation["invitedBy"]!["name"]!.GetValue<string>());
            Assert.Equal("https://example.com/ada.png", inboxInvitation["invitedBy"]!["avatarUrl"]!.GetValue<string>());
            Assert.Equal("#123456", inboxInvitation["orb"]!["colors"]![0]!.GetValue<string>());
            Assert.Equal(0.65, inboxInvitation["orb"]!["speed"]!.GetValue<double>());
        }
    }
}
