/**
 * Logger Unit Tests
 */

import { expect } from 'chai';
import { logger, setLogLevel, LogLevel } from '../src/common/logger';

describe('Logger', () => {
  let originalLevel: LogLevel;

  beforeEach(() => {
    originalLevel = setLogLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    setLogLevel(originalLevel);
  });

  // ============================================
  // LogLevel enum
  // ============================================
  describe('LogLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.DEBUG).to.equal(0);
      expect(LogLevel.INFO).to.equal(1);
      expect(LogLevel.WARN).to.equal(2);
      expect(LogLevel.ERROR).to.equal(3);
      expect(LogLevel.SILENT).to.equal(4);
    });

    it('should have DEBUG < INFO < WARN < ERROR < SILENT ordering', () => {
      expect(LogLevel.DEBUG).to.be.lessThan(LogLevel.INFO);
      expect(LogLevel.INFO).to.be.lessThan(LogLevel.WARN);
      expect(LogLevel.WARN).to.be.lessThan(LogLevel.ERROR);
      expect(LogLevel.ERROR).to.be.lessThan(LogLevel.SILENT);
    });
  });

  // ============================================
  // setLogLevel
  // ============================================
  describe('setLogLevel', () => {
    it('should return previous log level', () => {
      setLogLevel(LogLevel.WARN);
      const prev = setLogLevel(LogLevel.ERROR);
      expect(prev).to.equal(LogLevel.WARN);
    });

    it('should change the active log level', () => {
      setLogLevel(LogLevel.ERROR);
      const prev = setLogLevel(LogLevel.SILENT);
      expect(prev).to.equal(LogLevel.ERROR);
    });

    it('should accept all LogLevel values', () => {
      const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.SILENT];
      for (const level of levels) {
        setLogLevel(level);
        const returned = setLogLevel(LogLevel.DEBUG);
        expect(returned).to.equal(level);
      }
    });
  });

  // ============================================
  // Log methods — no-throw smoke tests
  // ============================================
  describe('log methods', () => {
    it('should not throw when calling debug()', () => {
      expect(() => logger.debug('TEST', 'debug message')).to.not.throw();
    });

    it('should not throw when calling info()', () => {
      expect(() => logger.info('TEST', 'info message')).to.not.throw();
    });

    it('should not throw when calling warn()', () => {
      expect(() => logger.warn('TEST', 'warn message')).to.not.throw();
    });

    it('should not throw when calling error()', () => {
      expect(() => logger.error('TEST', 'error message')).to.not.throw();
    });

    it('should accept extra variadic arguments', () => {
      expect(() => logger.info('TEST', 'msg', { key: 'value' }, 42)).to.not.throw();
    });
  });

  // ============================================
  // Log level filtering
  // ============================================
  describe('log level filtering', () => {
    let captured: string[];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    beforeEach(() => {
      captured = [];
      console.log = (...args: unknown[]) => { captured.push(args.join(' ')); };
      console.warn = (...args: unknown[]) => { captured.push(args.join(' ')); };
      console.error = (...args: unknown[]) => { captured.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    });

    it('should output debug messages when level is DEBUG', () => {
      setLogLevel(LogLevel.DEBUG);
      logger.debug('T', 'hello');
      expect(captured.length).to.equal(1);
      expect(captured[0]).to.include('[T]');
      expect(captured[0]).to.include('hello');
    });

    it('should suppress debug messages when level is INFO', () => {
      setLogLevel(LogLevel.INFO);
      logger.debug('T', 'hidden');
      expect(captured.length).to.equal(0);
    });

    it('should suppress all messages when level is SILENT', () => {
      setLogLevel(LogLevel.SILENT);
      logger.debug('T', 'a');
      logger.info('T', 'b');
      logger.warn('T', 'c');
      logger.error('T', 'd');
      expect(captured.length).to.equal(0);
    });

    it('should output error messages at ERROR level', () => {
      setLogLevel(LogLevel.ERROR);
      logger.debug('T', 'no');
      logger.info('T', 'no');
      logger.warn('T', 'no');
      logger.error('T', 'yes');
      expect(captured.length).to.equal(1);
      expect(captured[0]).to.include('yes');
    });

    it('should include ISO timestamp in output', () => {
      setLogLevel(LogLevel.DEBUG);
      logger.info('TAG', 'msg');
      expect(captured.length).to.equal(1);
      // ISO timestamp pattern: YYYY-MM-DDTHH:MM:SS
      expect(captured[0]).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
