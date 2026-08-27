export function isAdministrativeIdentity(user: unknown, role: unknown) {
  return Boolean(user) && role === "authenticated";
}
