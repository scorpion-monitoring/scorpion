import { describe, expect, it } from 'vitest';
import { BodyHost, type HostNode } from './body-host.ts';

class Fake implements HostNode<Fake> {
  parentNode: Fake | null = null;
  children: Fake[] = [];
  constructor(readonly name: string) {}
  appendChild(child: Fake) {
    child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    this.children.push(child);
  }
}
const names = (node: Fake) => node.children.map((child) => child.name);

describe('BodyHost', () => {
  it('shows a body in the slot of its tile and parks it when the tile goes', () => {
    const host = new BodyHost<Fake>();
    const home = new Fake('home');
    const body = new Fake('body-a');
    home.appendChild(body);
    host.home(home);
    host.stage('a', body);
    const slot = new Fake('slot');
    const release = host.slot('a', slot);
    expect(names(slot)).toEqual(['body-a']);
    expect(names(home)).toEqual([]);
    release();
    expect(names(home)).toEqual(['body-a']);
  });

  it('keeps the same element through a remount: the body is moved, never created again', () => {
    const host = new BodyHost<Fake>();
    const home = new Fake('home');
    const body = new Fake('body');
    home.appendChild(body);
    host.home(home);
    host.stage('a', body);
    const first = new Fake('first');
    const releaseFirst = host.slot('a', first);
    releaseFirst();
    const second = new Fake('second');
    host.slot('a', second);
    expect(second.children[0]).toBe(body);
    expect(first.children).toEqual([]);
  });

  it('lets a slot that arrives before the old one is released keep the body', () => {
    const host = new BodyHost<Fake>();
    const home = new Fake('home');
    const body = new Fake('body');
    home.appendChild(body);
    host.home(home);
    host.stage('a', body);
    const older = new Fake('older');
    const releaseOlder = host.slot('a', older);
    const newer = new Fake('newer');
    host.slot('a', newer);
    releaseOlder();
    expect(names(newer)).toEqual(['body']);
    expect(names(home)).toEqual([]);
  });

  it('shows a body whose slot was there first, and keeps bodies of other tiles apart', () => {
    const host = new BodyHost<Fake>();
    const home = new Fake('home');
    host.home(home);
    const slotA = new Fake('slot-a');
    host.slot('a', slotA);
    const bodyA = new Fake('body-a');
    const bodyB = new Fake('body-b');
    home.appendChild(bodyA);
    home.appendChild(bodyB);
    host.stage('a', bodyA);
    host.stage('b', bodyB);
    expect(names(slotA)).toEqual(['body-a']);
    expect(names(home)).toEqual(['body-b']);
  });

  it('does nothing for a body that was removed', () => {
    const host = new BodyHost<Fake>();
    const home = new Fake('home');
    host.home(home);
    const body = new Fake('body');
    home.appendChild(body);
    const forget = host.stage('a', body);
    forget();
    const slot = new Fake('slot');
    host.slot('a', slot);
    expect(names(slot)).toEqual([]);
  });
});
