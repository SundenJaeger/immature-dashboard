import {describe, expect, it} from "vitest";
import {buildRecordsCsv, CSV_HEADER, csvField, csvFileName} from "../../src/csv";
import {buildEntries} from "../../src/entries";
import {sample} from "./fixtures";

/** Minimal CSV parser for quoted fields, used only to check the output. */
function parse(text: string): string[][] {
    return text.trimEnd().split("\r\n").map((line) => {
        const cells: string[] = [];
        const pattern = /"((?:[^"]|"")*)"(?:,|$)/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) cells.push(match[1].replaceAll('""', '"'));
        return cells;
    });
}

describe("csvField", () => {
    it("quotes every value and doubles inner quotes", () => {
        expect(csvField("plain")).toBe('"plain"');
        expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
        expect(csvField("line\nbreak")).toBe('"line\nbreak"');
        expect(csvField(null)).toBe('""');
        expect(csvField(undefined)).toBe('""');
        expect(csvField(1.5)).toBe('"1.5"');
        expect(csvField(false)).toBe('"false"');
    });

    it("prefixes values that a spreadsheet would run as a formula", () => {
        expect(csvField("=SUM(A1:A2)")).toBe(`"'=SUM(A1:A2)"`);
        expect(csvField("+1")).toBe(`"'+1"`);
        expect(csvField("-1")).toBe(`"'-1"`);
        expect(csvField("@cmd")).toBe(`"'@cmd"`);
        expect(csvField("\tTab")).toBe(`"'\tTab"`);
        expect(csvField("a=b")).toBe('"a=b"');
    });
});

describe("buildRecordsCsv", () => {
    const entries = buildEntries([
        sample("2026WS", "T-001", 1, [{no: 1, weight: 2.4}, {no: 2, weight: 1.48}]),
        sample("2026WS", "T-001", 2, [{no: 1, weight: 1.49}]),
        sample("2026WS", "T-002", 1, [{no: 1, weight: 0.3, technician: "=HYPERLINK(\"x\")"}]),
    ], {largeDifferencePoints: 2.0});
    const table = parse(buildRecordsCsv(entries));

    it("writes the header with the server photo columns and the dashboard columns", () => {
        expect(table[0]).toEqual(CSV_HEADER);
        expect(CSV_HEADER.slice(0, 3)).toEqual(["id", "technician_name", "season"]);
        expect(CSV_HEADER.slice(-11)).toEqual([
            "counts_for_sample",
            "sample_weight",
            "sample_percentage",
            "sample_grade",
            "entry_status",
            "entry_mean_weight",
            "entry_percentage",
            "entry_grade",
            "entry_difference_points",
            "entry_sd_weight",
            "computed_by_dashboard",
        ]);
    });

    it("writes one row per photo, ordered by entry, sample and photo", () => {
        expect(table).toHaveLength(1 + 4);
        const label = CSV_HEADER.indexOf("replicate_label");
        expect(table.slice(1).map((row) => row[label])).toEqual([
            "2026WS-T-001-S1-01",
            "2026WS-T-001-S1-02",
            "2026WS-T-001-S2-01",
            "2026WS-T-002-S1-01",
        ]);
    });

    it("writes one full row with sample and entry results", () => {
        const row = Object.fromEntries(CSV_HEADER.map((name, index) => [name, table[2][index]]));
        expect(row).toEqual({
            id: "id-2026WS-T-001-S1-2",
            technician_name: "Test Technician",
            season: "2026WS",
            index_number: "T-001",
            selection_name: "Test Line",
            sample_id: "2026WS-T-001-S1",
            sample_no: "1",
            immature_weight: "1.48",
            percentage: "4.93",
            grade: "G1",
            meets_recommended_value: "false",
            review_status: "review",
            captured_at: "2026-11-24T01:00:00.000Z",
            submitted_at: "2026-11-24T01:00:42.000Z",
            processing_seconds: "42",
            created_at: "2026-11-24T01:00:42.000Z",
            image_secure_url: "https://example.invalid/image.png",
            ai_predicted_grains: "[]",
            confirmed_grains: "[]",
            replicate_no: "2",
            replicate_label: "2026WS-T-001-S1-02",
            confidence: "0.9",
            quality: "good",
            manually_overridden: "true",
            counts_for_sample: "true",
            sample_weight: "1.48",
            sample_percentage: "4.9",
            sample_grade: "Grade 1",
            entry_status: "accepted",
            entry_mean_weight: "1.485",
            entry_percentage: "5.0",
            entry_grade: "Grade 1",
            entry_difference_points: "0.1",
            entry_sd_weight: "0.007",
            computed_by_dashboard: "true",
        });
    });

    it("marks older photos as not counted and leaves pending entry results empty", () => {
        const col = (name: string) => CSV_HEADER.indexOf(name);
        expect(table[1][col("counts_for_sample")]).toBe("false");
        expect(table[1][col("entry_percentage")]).toBe("5.0");
        expect(table[4][col("entry_status")]).toBe("pending");
        expect(table[4][col("entry_percentage")]).toBe("");
        expect(table[4][col("technician_name")]).toBe(`'=HYPERLINK("x")`);
    });

    it("uses CRLF line endings", () => {
        expect(buildRecordsCsv(entries).endsWith("\r\n")).toBe(true);
    });
});

describe("csvFileName", () => {
    it("uses granular-records-YYYYMMDD.csv with the local date", () => {
        expect(csvFileName(new Date(2026, 10, 5, 7, 30))).toBe("granular-records-20261105.csv");
    });
});
