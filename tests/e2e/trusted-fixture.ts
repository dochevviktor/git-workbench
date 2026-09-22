/** Pass to page.evaluate: these scenarios deliberately run programs in their disposable repositories. */
export async function openTrustedFixture(path: string) {
  const result = await window.desktop!.repository.open({ path });
  if (result.ok) {
    const trusted = await window.desktop!.repository.setTrust({ id: result.value.id, trusted: true });
    if (!trusted.ok) throw new Error(trusted.error.message);
  }
  return result;
}
