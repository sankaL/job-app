import { describe, expect, it } from "vitest";
import {
  buildFilenameValues,
  renderFilename,
  validateFilenameTemplate,
} from "@/lib/exportFilename";

// Same cases as backend/tests/test_export_filename.py so the preview matches the download.
const values = (overrides: Parameters<typeof buildFilenameValues>[0] = {}) =>
  buildFilenameValues({ fullName: "Sanka Lokuliyana", ...overrides });

describe("export filename preview", () => {
  it("matches the backend rules", () => {
    expect(renderFilename(null, values(), "pdf")).toBe("Sanka Lokuliyana Resume.pdf");
    expect(renderFilename(null, values({ fullName: "Mary Jane  Smith" }), "docx")).toBe("Mary Smith Resume.docx");
    expect(renderFilename("{full name} CV", values({ fullName: "Mary Jane  Smith" }), "pdf")).toBe("Mary Jane Smith CV.pdf");
    expect(
      renderFilename("{company}__{job title}", values({ company: "Acme/Labs: R&D_Group", jobTitle: "Sr. Engineer*" }), "pdf"),
    ).toBe("Acme Labs R&D Group Sr. Engineer.pdf");
    expect(renderFilename("{company}", values({ company: "" }), "pdf")).toBe("Sanka Lokuliyana Resume.pdf");
    expect(renderFilename(null, buildFilenameValues({ fullName: "", firstName: "Ada", lastName: "Lovelace" }), "pdf")).toBe("Ada Lovelace Resume.pdf");
    expect(renderFilename(null, buildFilenameValues({ fullName: null }), "pdf")).toBe("Resume.pdf");
    expect(renderFilename(null, values({ fullName: "José Núñez" }), "pdf")).toBe("José Núñez Resume.pdf");
  });

  it.each(["सचिन तेंदुलकर", "සංකල් ලොකුලියන", "தமிழ் செல்வன்", "สมชาย ใจดี"])(
    "keeps combining marks in %s",
    (fullName) => {
      const parts = fullName.split(" ");
      expect(renderFilename(null, values({ fullName }), "pdf")).toBe(`${parts[0]} ${parts[parts.length - 1]} Resume.pdf`);
    },
  );

  it.each(["CON", "nul", "Com1", "LPT9"])("makes the Windows reserved name %s safe", (stem) => {
    expect(renderFilename(stem, values(), "pdf")).toBe(`${stem} Resume.pdf`);
  });

  it("validates templates like the backend", () => {
    expect(validateFilenameTemplate("")).toBeNull();
    expect(validateFilenameTemplate("{First Name} {last name} Resume")).toBeNull();
    expect(validateFilenameTemplate("{salary} Resume")).toBe("Unknown placeholder {salary}.");
    expect(validateFilenameTemplate("{first name Resume")).toBe("File name has an unmatched { or }.");
    expect(validateFilenameTemplate("x".repeat(121))).toMatch(/120 characters/);
    expect(validateFilenameTemplate("___")).toBe("File name must contain letters or numbers.");
  });
});
