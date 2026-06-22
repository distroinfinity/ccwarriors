export function StoryCloser({ login, hasStory }: { login: string; hasStory: boolean }) {
  if (!hasStory) return null;
  return (
    <a className="story-closer" href={`/${encodeURIComponent(login)}/story`}>
      <div className="story-closer-h">Who is {login} behind the tools?</div>
      <p className="story-closer-s">Their dev style, the calls they make, and how they got here.</p>
      <span className="story-closer-go mono">Read the story →</span>
    </a>
  );
}
