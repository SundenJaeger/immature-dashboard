import {describe, expect, it} from "vitest";
import {
    buildEntries,
    entryMatchesFilter,
    filterEntries,
    gradeDisplayName,
    gradeFromTenths,
    LARGE_DIFFERENCE_POINTS,
    type EntryRecord,
} from "../../src/entries";
import type {SampleRecord} from "../../src/types";
import {sample} from "./fixtures";

const options = {largeDifferencePoints: 2.0};

function only(samples: SampleRecord[]): EntryRecord {
    const entries = buildEntries(samples, options);
    expect(entries).toHaveLength(1);
    return entries[0];
}

function both(weight1: number, weight2: number): EntryRecord {
    return only([
        sample("2026WS", "T-001", 1, [{no: 1, weight: weight1}]),
        sample("2026WS", "T-001", 2, [{no: 1, weight: weight2}]),
    ]);
}

describe("buildEntries", () => {
    it("keeps an entry pending when no photo is Good", () => {
        const entry = only([sample("2026WS", "T-001", 1, [{no: 1, weight: 0.5, quality: "bad"}])]);

        expect(entry.status).toBe("pending");
        expect(entry.samples[0].counting).toBeNull();
        expect(entry.samples[1].sample).toBeNull();
        expect(entry.samples[1].counting).toBeNull();
        expect(entry.meanWeight).toBeNull();
        expect(entry.percentage).toBeNull();
        expect(entry.grade).toBeNull();
        expect(entry.differencePoints).toBeNull();
        expect(entry.sdWeight).toBeNull();
        expect(entry.largeDifference).toBe(false);
    });

    it("gives a sample result but keeps the entry pending when only one sample is Good", () => {
        const entry = only([
            sample("2026WS", "T-001", 1, [{no: 1, weight: 0.9}]),
            sample("2026WS", "T-001", 2, [{no: 1, weight: 0.6, quality: "bad"}]),
        ]);

        expect(entry.samples[0].weight).toBe(0.9);
        expect(entry.samples[0].percentage).toBe(3.0);
        expect(entry.samples[0].grade).toBe("Grade 1");
        expect(entry.samples[1].counting).toBeNull();
        expect(entry.status).toBe("pending");
        expect(entry.percentage).toBeNull();
    });

    it("accepts the entry and averages the two samples when both are Good", () => {
        const entry = both(0.9, 0.6);

        expect(entry.status).toBe("accepted");
        expect(entry.meanWeight).toBe(0.75);
        expect(entry.percentage).toBe(2.5);
        expect(entry.grade).toBe("Grade 1");
        expect(entry.key).toBe("2026WS|T-001");
        expect(entry.season).toBe("2026WS");
        expect(entry.indexNumber).toBe("T-001");
    });

    it("counts the latest Good photo and keeps the older photos visible", () => {
        const entry = only([
            sample("2026WS", "T-001", 1, [
                {no: 1, weight: 2.4},
                {no: 2, weight: 9.0, quality: "bad"},
                {no: 3, weight: 0.3},
            ]),
            sample("2026WS", "T-001", 2, [{no: 1, weight: 0.3}]),
        ]);

        expect(entry.samples[0].counting?.replicateNo).toBe(3);
        expect(entry.samples[0].older.map((photo) => photo.replicateNo)).toEqual([1, 2]);
        expect(entry.meanWeight).toBe(0.3);
        expect(entry.percentage).toBe(1.0);
        expect(entry.grade).toBe("Premium");
    });

    it("uses replicate number, not array order, to find the latest Good photo", () => {
        const s1 = sample("2026WS", "T-001", 1, [{no: 2, weight: 0.3}, {no: 1, weight: 2.4}]);
        const entry = only([s1, sample("2026WS", "T-001", 2, [{no: 1, weight: 0.3}])]);

        expect(entry.samples[0].counting?.replicateNo).toBe(2);
        expect(entry.samples[0].older.map((photo) => photo.replicateNo)).toEqual([1]);
    });

    it("never counts a rejected photo, even when it is Good", () => {
        const entry = only([
            sample("2026WS", "T-001", 1, [{no: 1, weight: 0.3}, {no: 2, weight: 3.0, status: "rejected"}]),
            sample("2026WS", "T-001", 2, [{no: 1, weight: 0.3}]),
        ]);

        expect(entry.samples[0].counting?.replicateNo).toBe(1);
        expect(entry.samples[0].weight).toBe(0.3);
    });

    it("rounds 4.95% half up to 5.0% (Grade 1) for 1.48 g and 1.49 g", () => {
        const entry = both(1.48, 1.49);

        // A floating-point version gives (1.48 + 1.49) / 2 / 30 * 100 = 4.9499... and rounds to 4.9.
        expect(entry.meanWeight).toBe(1.485);
        expect(entry.percentage).toBe(5.0);
        expect(entry.grade).toBe("Grade 1");
    });

    it("rounds 5.05% half up to 5.1% (Grade 2) for 1.51 g and 1.52 g", () => {
        const entry = both(1.51, 1.52);

        expect(entry.meanWeight).toBe(1.515);
        expect(entry.percentage).toBe(5.1);
        expect(entry.grade).toBe("Grade 2");
    });

    it("rounds 1.983% up to 2.0% (Grade 1) at the Premium boundary", () => {
        const entry = both(0.59, 0.6);

        expect(entry.percentage).toBe(2.0);
        expect(entry.grade).toBe("Grade 1");
    });

    it("flags a large difference between the two samples and still accepts the entry", () => {
        const entry = both(0.3, 3.0);

        expect(entry.samples[0].percentage).toBe(1.0);
        expect(entry.samples[1].percentage).toBe(10.0);
        expect(entry.differencePoints).toBe(9.0);
        expect(entry.largeDifference).toBe(true);
        expect(entry.status).toBe("accepted");
        expect(entry.sdWeight).toBeCloseTo(2.7 / Math.SQRT2, 10);
    });

    it("does not flag a difference equal to the threshold", () => {
        // 0.30 g = 1.0%, 0.90 g = 3.0%: difference 2.0 points.
        const entry = both(0.3, 0.9);

        expect(entry.differencePoints).toBe(2.0);
        expect(entry.largeDifference).toBe(false);
    });

    it("keeps samples without season or index number in their own entries", () => {
        const legacyA = {...sample("2026WS", "T-001", 1, [{no: 1, weight: 0.3}]), season: null, sampleId: "legacy-a"};
        const legacyB = {...sample("2026WS", "T-002", 1, [{no: 1, weight: 0.3}]), season: null, sampleId: "legacy-b"};
        const entries = buildEntries([legacyA, legacyB], options);

        expect(entries.map((entry) => entry.key)).toEqual(["?|legacy-a", "?|legacy-b"]);
        expect(entries.every((entry) => entry.status === "pending")).toBe(true);
    });

    it("lists a sample number other than 1 or 2 under Other and never counts it", () => {
        const entry = only([
            sample("2026WS", "T-001", 1, [{no: 1, weight: 0.3}]),
            sample("2026WS", "T-001", 3, [{no: 1, weight: 0.3}]),
        ]);

        expect(entry.others.map((other) => other.sampleNo)).toEqual([3]);
        expect(entry.samples[1].sample).toBeNull();
        expect(entry.status).toBe("pending");
    });

    it("groups samples of different entries separately", () => {
        const entries = buildEntries([
            sample("2026WS", "T-001", 1, [{no: 1, weight: 0.3}]),
            sample("2026WS", "T-002", 1, [{no: 1, weight: 0.3}]),
            sample("2026WS", "T-001", 2, [{no: 1, weight: 0.3}]),
            sample("2027DS", "T-001", 1, [{no: 1, weight: 0.3}]),
        ], options);

        expect(entries.map((entry) => [entry.key, entry.status])).toEqual([
            ["2026WS|T-001", "accepted"],
            ["2026WS|T-002", "pending"],
            ["2027DS|T-001", "pending"],
        ]);
    });
});

describe("grade helpers", () => {
    it("maps NCT Table 4 boundaries", () => {
        expect(gradeFromTenths(19)).toBe("Premium");
        expect(gradeFromTenths(20)).toBe("Grade 1");
        expect(gradeFromTenths(50)).toBe("Grade 1");
        expect(gradeFromTenths(51)).toBe("Grade 2");
        expect(gradeFromTenths(100)).toBe("Grade 2");
        expect(gradeFromTenths(101)).toBe("Grade 3");
        expect(gradeFromTenths(150)).toBe("Grade 3");
        expect(gradeFromTenths(151)).toBe("Not classified");
    });

    it("shows display names without changing API values", () => {
        expect(gradeDisplayName("Pr")).toBe("Premium");
        expect(gradeDisplayName("G1")).toBe("Grade 1");
        expect(gradeDisplayName("G2")).toBe("Grade 2");
        expect(gradeDisplayName("G3")).toBe("Grade 3");
        expect(gradeDisplayName("Not Classified")).toBe("Not classified");
        expect(gradeDisplayName(null)).toBeNull();
    });

    it("uses a 2.0-point placeholder threshold", () => {
        expect(LARGE_DIFFERENCE_POINTS).toBe(2.0);
    });
});

describe("entry filters and search", () => {
    const entries = buildEntries([
        sample("2026WS", "T-001", 1, [{no: 1, weight: 0.3}]),
        sample("2026WS", "T-001", 2, [{no: 1, weight: 3.0}]),
        sample("2026WS", "T-002", 1, [{no: 1, weight: 0.3, status: "rejected"}]),
        sample("2026WS", "T-003", 1, [{no: 1, weight: 0.4, quality: "bad", status: "retraining", technician: "Ana Cruz"}]),
        sample("2026WS", "T-004", 1, [{no: 1, weight: 0.6}]),
        sample("2026WS", "T-004", 2, [{no: 1, weight: 0.6}]),
    ], options);
    const keys = (list: EntryRecord[]) => list.map((entry) => entry.indexNumber);

    it("filters by entry status, large difference and photo status", () => {
        expect(keys(filterEntries(entries, "all", ""))).toEqual(["T-001", "T-002", "T-003", "T-004"]);
        expect(keys(filterEntries(entries, "accepted", ""))).toEqual(["T-001", "T-004"]);
        expect(keys(filterEntries(entries, "pending", ""))).toEqual(["T-002", "T-003"]);
        expect(keys(filterEntries(entries, "large", ""))).toEqual(["T-001"]);
        expect(keys(filterEntries(entries, "rejected", ""))).toEqual(["T-002"]);
        expect(keys(filterEntries(entries, "retraining", ""))).toEqual(["T-003"]);
        expect(entryMatchesFilter(entries[0], "all")).toBe(true);
    });

    it("searches by index number, sample ID, photo label and technician, ignoring case", () => {
        expect(keys(filterEntries(entries, "all", "t-004"))).toEqual(["T-004"]);
        expect(keys(filterEntries(entries, "all", "2026WS-T-002-S1"))).toEqual(["T-002"]);
        expect(keys(filterEntries(entries, "all", "2026WS-T-001-S2-01"))).toEqual(["T-001"]);
        expect(keys(filterEntries(entries, "all", "ana cruz"))).toEqual(["T-003"]);
        expect(keys(filterEntries(entries, "accepted", "T-00"))).toEqual(["T-001", "T-004"]);
        expect(filterEntries(entries, "all", "no-such-entry")).toEqual([]);
    });
});
