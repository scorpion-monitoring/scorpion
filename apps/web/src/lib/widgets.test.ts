import { describe, expect, it } from 'vitest';
import { uiModules } from '../generated/ui.ts';
import { widgetLoaders } from './widgets.ts';

const loader = () => Promise.reject(new Error('not loaded in a unit test'));

describe('widgetLoaders', () => {
  it('collects the widgets of every module by name', () => {
    expect(
      Object.keys(
        widgetLoaders([
          { package: 'a', widgets: { one: loader, two: loader } },
          { package: 'b', widgets: { three: loader } },
        ]),
      ),
    ).toEqual(['one', 'two', 'three']);
  });

  it('refuses a name that two modules offer, naming both', () => {
    expect(() =>
      widgetLoaders([
        { package: 'a', widgets: { bell: loader } },
        { package: 'b', widgets: { bell: loader } },
      ]),
    ).toThrow('widget "bell" is offered by both a and b');
  });

  it('holds for the modules of this profile', () => {
    expect(() => widgetLoaders(uiModules)).not.toThrow();
  });
});
