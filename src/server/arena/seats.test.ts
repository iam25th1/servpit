// The ceiling on spectators, and what happens at it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_STREAMS, PIT_FULL, StreamSeats, maxStreams } from "./seats";

afterEach(() => vi.unstubAllEnvs());

describe("counting the seats in front of the stream", () => {
  it("lets spectators in up to the ceiling and then says so", () => {
    const seats = new StreamSeats(() => 2);
    expect(seats.take()).toBe(true);
    expect(seats.take()).toBe(true);
    expect(seats.take()).toBe(false);
    expect(seats.taken).toBe(2);
  });

  it("gives a seat back when one leaves, whoever leaves first", () => {
    const seats = new StreamSeats(() => 1);
    expect(seats.take()).toBe(true);
    expect(seats.take()).toBe(false);
    seats.give();
    expect(seats.taken).toBe(0);
    expect(seats.take()).toBe(true);
  });

  it("does not count a seat back twice, however many ways a stream ends", () => {
    // A client that hangs up can reach both the stream's close and its
    // cancel. Counting both would hand out a seat that is still held.
    const seats = new StreamSeats(() => 2);
    seats.take();
    seats.give();
    seats.give();
    expect(seats.taken).toBe(0);
  });

  it("reads the ceiling every time, so an operator can change it", () => {
    let ceiling = 1;
    const seats = new StreamSeats(() => ceiling);
    expect(seats.take()).toBe(true);
    expect(seats.take()).toBe(false);
    ceiling = 3;
    expect(seats.take()).toBe(true);
  });
});

describe("the configured ceiling", () => {
  it("is the measured default when nothing is set", () => {
    vi.stubEnv("SERVPIT_MAX_STREAMS", "");
    expect(maxStreams()).toBe(DEFAULT_MAX_STREAMS);
  });

  it("is whatever whole number the operator set", () => {
    vi.stubEnv("SERVPIT_MAX_STREAMS", "500");
    expect(maxStreams()).toBe(500);
  });

  it("refuses a setting that is not a count", () => {
    for (const raw of ["0", "-1", "lots", "1.5"]) {
      vi.stubEnv("SERVPIT_MAX_STREAMS", raw);
      expect(() => maxStreams(), raw).toThrow(RangeError);
    }
  });
});

describe("what a refused spectator is told", () => {
  it("is one sentence with nothing about the machine in it", () => {
    expect(PIT_FULL).toBe("The pit has all the watchers it can hold right now. The round is still there to read.");
    for (const word of ["memory", "connection", "socket", "process", "cpu", "server"]) {
      expect(PIT_FULL.toLowerCase()).not.toContain(word);
    }
  });
});
