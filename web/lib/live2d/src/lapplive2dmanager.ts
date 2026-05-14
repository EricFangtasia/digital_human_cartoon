/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { csmVector } from '@framework/type/csmvector';

import * as LAppDefine from './lappdefine';
import { LAppModel } from './lappmodel';
import { LAppPal } from './lapppal';
import { LAppSubdelegate } from './lappsubdelegate';
import { ResourceModel } from '@/lib/protocol';
import * as path from 'path';

/**
 * サンプルアプリケーションにおいてCubismModelを管理するクラス
 * モデル生成と破棄、タップイベントの処理、モデル切り替えを行う。
 */
export class LAppLive2DManager {
  /**
   * 現在のシーンで保持しているすべてのモデルを解放する
   */
  private releaseAllModel(): void {
    this._models.clear();
  }

  /**
   * 画面をドラッグした時の処理
   *
   * @param x 画面のX座標
   * @param y 画面のY座標
   */
  public onDrag(x: number, y: number): void {
    const model: LAppModel = this._models.at(0);
    if (model) {
      model.setDragging(x, y);
    }
  }

  /**
   * 画面をタップした時の処理
   *
   * @param x 画面のX座標
   * @param y 画面のY座標
   */
  public onTap(x: number, y: number): void {
    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(
        `[APP]tap point: {x: ${x.toFixed(2)} y: ${y.toFixed(2)}}`
      );
    }

    const model: LAppModel = this._models.at(0);
    if (!model) return;
    
    // 点击任意位置都触发交互
    this.playTouchReaction(model);
  }

  /**
   * 播放触摸反馈
   * @param model 被点击的模型
   */
  private playTouchReaction(model: LAppModel): void {
    console.log('[Live2D] Touch detected, playing reaction');
    
    // 随机反应话术
    const reactions = [
      "讨厌~",
      "不要这样子嘛",
      "好舒服啊",
      "哥哥我错了",
      "哈哈哈",
      "干嘛啦",
      "你在干什么",
      "不要碰我",
      "好痒啊",
      "嘿嘿~",
      "人家会害羞的啦",
      "讨厌，别摸了",
      "嗯~好舒服",
      "主人真坏",
      "再这样我要生气了哦",
      "呀~轻一点",
      "好痒好痒",
      "你想干嘛呀",
      "人家不给你摸",
      "哼~坏蛋",
      "诶嘿嘿~",
      "主人好色",
      "别闹了啦",
      "讨厌死了",
      "你好坏哦"
    ];
    
    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
    console.log(`[Live2D] Reaction: ${randomReaction}`);
    
    // 播放表情（如果模型有的话）
    model.setRandomExpression();
    
    // 播放身体触碰动作（如果模型有的话）
    model.startRandomMotion(
      LAppDefine.MotionGroupTapBody,
      LAppDefine.PriorityNormal,
      null,
      null
    );
    
    // 触发自定义事件，让外部处理TTS
    const event = new CustomEvent('live2d:touch', {
      detail: { text: randomReaction }
    });
    document.dispatchEvent(event);
  }

  /**
   * 画面を更新するときの処理
   * モデルの更新処理及び描画処理を行う
   */
  public onUpdate(): void {
    const { width, height } = this._subdelegate.getCanvas();

    const projection: CubismMatrix44 = new CubismMatrix44();
    const model: LAppModel = this._models.at(0);
    if (!model) return;
    if (model.getModel()) {
      if (model.getModel().getCanvasWidth() > 1.0 && width < height) {
        // 横に長いモデルを縦長ウィンドウに表示する際モデルの横サイズでscaleを算出する
        model.getModelMatrix().setWidth(2.0);
        projection.scale(1.0, width / height);
      } else {
        projection.scale(height / width, 1.0);
      }

      // 必要があればここで乗算
      if (this._viewMatrix != null) {
        projection.multiplyByMatrix(this._viewMatrix);
      }
    }

    model.update();
    model.draw(projection); // 参照渡しなのでprojectionは変質する。
  }

  /**
   * 次のシーンに切りかえる
   * サンプルアプリケーションではモデルセットの切り替えを行う。
   */
  // public nextScene(): void {
  //   const no: number = (this._sceneIndex + 1) % LAppDefine.ModelDirSize;
  //   this.changeScene(no);
  // }

  /**
   * シーンを切り替える
   * サンプルアプリケーションではモデルセットの切り替えを行う。
   * @param index
   */
  // private changeScene(index: number): void {
  //   this._sceneIndex = index;

  //   if (LAppDefine.DebugLogEnable) {
  //     LAppPal.printMessage(`[APP]model index: ${this._sceneIndex}`);
  //   }

  //   // ModelDir[]に保持したディレクトリ名から
  //   // model3.jsonのパスを決定する。
  //   // ディレクトリ名とmodel3.jsonの名前を一致させておくこと。
  //   const model: string = LAppDefine.ModelDir[index];
  //   const modelPath: string = LAppDefine.ResourcesPath + model + '/';
  //   let modelJsonName: string = LAppDefine.ModelDir[index];
  //   modelJsonName += '.model3.json';

  //   this.releaseAllModel();
  //   const instance = new LAppModel();
  //   instance.setSubdelegate(this._subdelegate);
  //   instance.loadAssets(modelPath, modelJsonName);
  //   this._models.pushBack(instance);
  // }

  public setViewMatrix(m: CubismMatrix44) {
    for (let i = 0; i < 16; i++) {
      this._viewMatrix.getArray()[i] = m.getArray()[i];
    }
  }

  /**
   * モデルの追加
   */
  // public addModel(sceneIndex: number = 0): void {
  //   this._sceneIndex = sceneIndex;
  //   this.changeScene(this._sceneIndex);
  // }

  /**
   * コンストラクタ
   */
  public constructor() {
    this._subdelegate = null;
    this._viewMatrix = new CubismMatrix44();
    this._models = new csmVector<LAppModel>();
    this._character = null;
    // this._sceneIndex = 0;
  }

  /**
   * 解放する。
   */
  public release(): void {}

  /**
   * 初期化する。
   * @param subdelegate
   */
  public initialize(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
    this.changeCharacter(this._character);
  }

  public changeCharacter(character: ResourceModel | null) {
    if (character == null) {
      this.releaseAllModel();
      return;
    }
    let dir = path.dirname(character.link) + "/";
    let modelJsonName: string = `${character.name}.model3.json`;
    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(`[APP]model json: ${modelJsonName}`);
    }

    this.releaseAllModel();
    const instance = new LAppModel();
    instance.setSubdelegate(this._subdelegate);
    instance.loadAssets(dir, modelJsonName);
    this._models.pushBack(instance);
    this._character = character;
  }

  /**
   * 获取当前模型
   */
  public getCurrentModel(): LAppModel | null {
    if (this._models.getSize() > 0) {
      return this._models.at(0);
    }
    return null;
  }

  /**
   * 自身が所属するSubdelegate
   */
  private _subdelegate: LAppSubdelegate;

  _viewMatrix: CubismMatrix44; // モデル描画に用いるview行列
  _models: csmVector<LAppModel>; // モデルインスタンスのコンテナ
  // private _sceneIndex: number; // 表示するシーンのインデックス値
  private _character: ResourceModel | null;

  // モーション再生開始のコールバック関数
  beganMotion = (self: ACubismMotion): void => {
    LAppPal.printMessage('Motion Began');
  };
  // モーション再生終了のコールバック関数
  finishedMotion = (self: ACubismMotion): void => {
    LAppPal.printMessage('Motion Finished');
  };
}
