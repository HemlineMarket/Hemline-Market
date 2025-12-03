// scripts/threadtalk-notifications.js
// Standalone notification logic for ThreadTalk
// This file hooks into your existing ThreadTalk without modifying threadtalk.js

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn("[Notifications] Supabase missing — notifications disabled.");
    return;
  }

  // ------------------------------------------------------------
  // Helper: Insert a notification row
  // ------------------------------------------------------------
  async function createThreadNotification({
    recipientId,
    actorId,
    threadId = null,
    commentId = null,
    reactionId = null,
    type,
    message,
  }) {
    if (!recipientId || !actorId || recipientId === actorId) return;

    const { error } = await supabase.from("thread_notifications").insert([
      {
        recipient_id: recipientId,
        actor_id: actorId,
        thread_id: threadId,
        comment_id: commentId,
        reaction_id: reactionId,
        type,
        message,
      },
    ]);

    if (error) {
      console.warn("[Notifications] Insert failed:", error.message);
    }
  }

  // ------------------------------------------------------------
  // Hook into global ThreadTalk events
  // ------------------------------------------------------------
  document.addEventListener("threadtalk:comment-created", async (e) => {
    const { user, thread, comment, parentComment, profile } = e.detail;

    const displayName = profile?.display_name || "Someone";

    if (!comment.parent_comment_id) {
      // New top-level comment → notify the thread author
      await createThreadNotification({
        recipientId: thread.author_id,
        actorId: user.id,
        threadId: thread.id,
        commentId: comment.id,
        type: "thread_comment",
        message: `${displayName} commented on your thread "${thread.title}".`,
      });
    } else {
      // Reply → notify parent comment author
      await createThreadNotification({
        recipientId: parentComment.author_id,
        actorId: user.id,
        threadId: thread.id,
        commentId: comment.id,
        type: "comment_reply",
        message: `${displayName} replied to your comment on "${thread.title}".`,
      });
    }
  });

  document.addEventListener("threadtalk:reaction-added", async (e) => {
    const { user, thread, comment, reaction, profile } = e.detail;

    const displayName = profile?.display_name || "Someone";
    const targetAuthor = comment ? comment.author_id : thread.author_id;

    await createThreadNotification({
      recipientId: targetAuthor,
      actorId: user.id,
      threadId: thread.id,
      commentId: comment ? comment.id : null,
      reactionId: reaction.id,
      type: "reaction",
      message: `${displayName} reacted to your ${comment ? "comment" : "thread"}.`,
    });
  });
})();
