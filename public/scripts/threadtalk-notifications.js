// scripts/threadtalk-notifications.js
// Standalone notification logic for ThreadTalk

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) return;

  async function createNotification({
    recipientId,
    actorId,
    type,
    threadId = null,
    commentId = null,
    reactionId = null,
    message
  }) {
    if (!recipientId || !actorId || recipientId === actorId) return;

    await supabase.from("notifications").insert({
      user_id: recipientId,
      actor_id: actorId,
      type,
      title: message,
      body: message,
      thread_id: threadId,
      comment_id: commentId,
      reaction_id: reactionId,
      read_at: null,
      metadata: { thread_id: threadId, comment_id: commentId }
    });
  }

  document.addEventListener("threadtalk:comment-created", async (e) => {
    const { user, thread, comment, parentComment, profile } = e.detail;

    const displayName = profile?.display_name || "Someone";

    if (!comment.parent_comment_id) {
      await createNotification({
        recipientId: thread.author_id,
        actorId: user.id,
        type: "thread_comment",
        threadId: thread.id,
        commentId: comment.id,
        message: `${displayName} commented on your thread: ${thread.title}`
      });
    } else {
      await createNotification({
        recipientId: parentComment.author_id,
        actorId: user.id,
        type: "comment_reply",
        threadId: thread.id,
        commentId: comment.id,
        message: `${displayName} replied to your comment on: ${thread.title}`
      });
    }
  });

  document.addEventListener("threadtalk:reaction-added", async (e) => {
    const { user, thread, comment, reaction, profile } = e.detail;

    const displayName = profile?.display_name || "Someone";
    const targetAuthor = comment ? comment.author_id : thread.author_id;

    await createNotification({
      recipientId: targetAuthor,
      actorId: user.id,
      type: "reaction",
      threadId: thread.id,
      commentId: comment ? comment.id : null,
      reactionId: reaction.id,
      message: `${displayName} reacted to your ${comment ? "comment" : "thread"}`
    });
  });
})();
