import "server-only";
import { z } from "zod";
import { DomainError, type DomainErrorCode } from "@/domain/errors";

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  not_found: 404,
  invalid_transition: 409,
  conflict: 409,
  not_eligible: 422,
};

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return Response.json({ error: error.message, code: error.code }, { status: STATUS_BY_CODE[error.code] });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Invalid request", code: "invalid_request" }, { status: 400 });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong", code: "internal" }, { status: 500 });
}

export async function handle(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    return errorResponse(error);
  }
}
