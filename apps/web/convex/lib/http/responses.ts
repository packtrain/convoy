export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const jsonError = (message: string, status: number) =>
  jsonResponse({ error: message }, status);
