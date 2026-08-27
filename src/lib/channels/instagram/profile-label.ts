export function instagramProfileLabel(username: string | null) {
  return username ? `@${username}` : "Usuario de Instagram";
}
