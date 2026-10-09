import React from 'react';
import {Composition} from 'remotion';
import {Intro} from './scenes/Intro';
import {Moods} from './scenes/Moods';
import {IdleLoop} from './scenes/IdleLoop';
import {Littermates} from './scenes/Littermates';
import {IconStill, LOOP, MoodLoop, PoseStill} from './scenes/AppAssets';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="YumiIntro" component={Intro} durationInFrames={210} fps={30} width={1920} height={1080} />
    <Composition id="YumiMoods" component={Moods} durationInFrames={240} fps={30} width={1920} height={1080} />
    <Composition id="YumiLittermates" component={Littermates} durationInFrames={180} fps={30} width={1920} height={1080} />
    <Composition
      id="YumiIdleLoop"
      component={IdleLoop}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{transparent: false}}
    />
    <Composition
      id="YumiSticker"
      component={IdleLoop}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{transparent: true}}
    />
    <Composition id="YumiMoodLoop" component={MoodLoop} durationInFrames={LOOP} fps={30} width={512} height={512} defaultProps={{state: 'idle' as const}} />
    <Composition id="YumiIcon" component={IconStill} durationInFrames={1} fps={30} width={1024} height={1024} defaultProps={{kind: 'mark' as const}} />
    <Composition id="YumiPose"component={PoseStill} durationInFrames={LOOP} fps={30} width={256} height={256} defaultProps={{state: 'idle' as const}} />
  </>
);
