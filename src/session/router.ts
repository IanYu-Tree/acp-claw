export function getSessionKey(channelName: string, senderId: string): string {
  if (senderId) {
    return `${channelName}_user_${senderId}`;
  }
  return 'default';
}
